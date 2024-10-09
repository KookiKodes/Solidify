import type { Plugin } from 'vite';
import { getStorefrontEnv } from './utils/env.js';
import {
  getShopLocalization,
  type ShopLocalizationResult,
} from './utils/getShopLocalization.js';
import { debugLog } from './utils/debugLog.js';

import { Localizations, IsoCode, Locale } from './types.js';

function buildShopLocales(
  defaultLocale: IsoCode,
  localization: ShopLocalizationResult,
): Localizations {
  //@ts-expect-error
  return localization.availableCountries.reduce(
    (localizations: Localizations, localization) => {
      localization.availableLanguages.forEach((language) => {
        const isoCode =
          `${language.isoCode.toLowerCase()}-${localization.isoCode}` as IsoCode;
        const data: Locale = {
          country: localization.isoCode,
          currency: localization.currency.isoCode,
          isoCode,
          label: `${language.name} (${localization.currency.isoCode} ${localization.currency.symbol})`,
          language: language.isoCode,
          languageLabel: language.endonymName,
          market: {
            id: localization.market.id,
            handle: localization.market.handle,
          },
        };
        if (isoCode === defaultLocale) localizations.default = data;
        else
          localizations[`/${isoCode.toLowerCase() as Lowercase<IsoCode>}`] =
            data;
      });
      return localizations;
    },
    {},
  );
}

const DEFAULT_LOCALE: IsoCode = 'en-US',
  DEFAULT_NAMESPACE =
    '@solidifront/vite-plugin-generate-shopify-locales/locales';

export namespace generateShopifyShopLocales {
  export type Options = {
    /**
     * The fallback locale to use if no other locale is found.
     *
     * @defaultValue `en-us`
     */
    defaultLocale?: IsoCode;
    /**
     * Log various steps to aid in tracking down bugs.
     *
     * @defaultValue `false`
     */
    debug?: boolean;

    /**
     * The namespace to use for the virtual module.
     * @defaultValue `@solidifront/vite-plugin-generate-shopify-locales/locales`
     */
    namespace?: string;
  };
}

function generateShopifyShopLocales(
  options?: generateShopifyShopLocales.Options,
): Plugin {
  const {
    debug = false,
    defaultLocale = DEFAULT_LOCALE,
    namespace = DEFAULT_NAMESPACE,
  } = options ?? {
    defaultLocale: DEFAULT_LOCALE,
    namespace: DEFAULT_NAMESPACE,
  };

  const virtualModuleId = namespace;
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  const log = (...args: unknown[]) => {
    if (!debug) return;
    debugLog(...args);
  };

  if (options) log('Plugin initialized with options:', options);

  let countries: Localizations;

  let controller: AbortController | null = null;

  return {
    name: 'vite-plugin-generate-shopify-locales',
    enforce: 'pre',
    async buildStart(options) {
      try {
        log('Validating correct environment variables...');
        const env = getStorefrontEnv.call(this);
        log(
          'Overriding declaration file for virtual module: ' + virtualModuleId,
        );
        // const dtsContext = await fs.readFile(path.resolve(".",), 'utf8');
        log('Fetching shop locales...');
        if (controller) {
          controller.abort('Duplicate request aborted.');
          controller = null;
        }
        controller = new AbortController();
        const localization = await getShopLocalization({
          ...env,
          signal: controller?.signal,
        });
        controller = null;
        log('Building shop locales');
        countries = buildShopLocales(defaultLocale, localization);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(error.message);
        }
      }
    },
    resolveId(id) {
      if (id !== virtualModuleId) return;
      return resolvedVirtualModuleId;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `
          export const countries = ${JSON.stringify(countries, null, 2)};
        `;
      }
    },
  };
}

export default generateShopifyShopLocales;

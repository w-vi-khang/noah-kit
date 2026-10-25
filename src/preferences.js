// Language, optional script, optional region: "vi", "pt-BR", "zh-Hant-TW".
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?$/;

// Returns the canonical BCP 47 form of a supported tag, or throws.
export function normalizeLanguageTag(tag) {
  if (typeof tag !== 'string' || !LANGUAGE_TAG_PATTERN.test(tag)) {
    throw new Error(`Unsupported language tag "${tag}". Use a BCP 47 tag such as vi, en, or pt-BR.`);
  }
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    throw new Error(`Unsupported language tag "${tag}". Use a BCP 47 tag such as vi, en, or pt-BR.`);
  }
}

export function isCanonicalLanguageTag(tag) {
  try {
    return normalizeLanguageTag(tag) === tag;
  } catch {
    return false;
  }
}

export function describeLanguage(tag) {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
    return name && name !== tag ? `${tag} (${name})` : tag;
  } catch {
    return tag;
  }
}

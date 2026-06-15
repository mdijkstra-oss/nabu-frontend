export const ENTITY_ID_SUFFIX = "[0-9][a-z0-9]{7}"

export const ENTITY_ID_PARTIAL = "(?:[0-9][a-z0-9]{0,6})?"

export const ENTITY_ID_SUFFIX_RE = new RegExp(`^${ENTITY_ID_SUFFIX}$`)

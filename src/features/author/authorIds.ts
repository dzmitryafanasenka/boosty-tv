/** Focus ids of the Author page (docs/focus-map.md §1.5). */
export const AUTHOR_STATE_ACTION_ID = 'state/author/action';
export const authorCardPrefix = (blogUrl: string) => `author/${blogUrl}/post/`;
export const authorCardId = (blogUrl: string, postId: string) =>
  `${authorCardPrefix(blogUrl)}${postId}`;
export const authorRetryId = (blogUrl: string) => `author/${blogUrl}/retry`;
/** The action row (Story 5.7): «Поиск в блоге», «Фильтры», «Сбросить». */
export const authorSearchId = (blogUrl: string) => `author/${blogUrl}/action/search`;
export const authorFiltersId = (blogUrl: string) => `author/${blogUrl}/action/filters`;
export const authorResetId = (blogUrl: string) => `author/${blogUrl}/action/reset`;
/** Story 7.1: the LiveCard (docs/focus-map.md §1.5). */
export const authorLiveId = (blogUrl: string) => `author/${blogUrl}/live`;
/** Story 7.4: «Нравится» and «Поделиться» right of the LiveCard. */
export const authorLiveLikeId = (blogUrl: string) => `${authorLiveId(blogUrl)}/like`;
export const authorLiveShareId = (blogUrl: string) => `${authorLiveId(blogUrl)}/share`;

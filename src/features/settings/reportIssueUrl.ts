/**
 * «Сообщить о проблеме» (Story 15.1, IMP-09, FR-66): the URL of a new
 * GitHub issue with the bug form (`.github/ISSUE_TEMPLATE/bug_report.yml`).
 * An issue form field's `id` is its URL query parameter for prefill
 * (docs.github.com, «Syntax for GitHub's form schema», checked 2026-11-04),
 * so `version` and `device` fill those fields. The input is app and device
 * facts only: no account data ever enters this URL. The URL is only drawn
 * as a QR code, never shown in full, logged or stored.
 */

export type ReportIssueInfo = {
  /** The installed `versionName`, or null when unknown (left out). */
  version: string | null;
  /** «Google Chromecast, Android 14», or null when unknown (left out). */
  device: string | null;
};

/** The repository's web page, `https://github.com/<owner>/<repo>`. */
export function repositoryUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

/** `…/issues/new?template=bug_report.yml&version=…&device=…`, every value encoded. */
export function reportIssueUrl(repository: string, { version, device }: ReportIssueInfo): string {
  const params: Array<[string, string]> = [['template', 'bug_report.yml']];
  if (version !== null && version.trim().length > 0) {
    params.push(['version', version.trim()]);
  }
  if (device !== null && device.trim().length > 0) {
    params.push(['device', device.trim()]);
  }
  const query = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${repositoryUrl(repository)}/issues/new?${query}`;
}

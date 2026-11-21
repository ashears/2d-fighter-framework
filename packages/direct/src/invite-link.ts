const inviteParameter = 'invite';

/** Keep the WebRTC offer in the fragment so it stays out of HTTP requests. */
export function createInviteLink(page: string | URL, invite: string): string {
  const url = new URL(page);
  url.hash = new URLSearchParams({ [inviteParameter]: invite }).toString();
  return url.href;
}

/** Extract the offer from a lobby URL. The connection validates the offer before use. */
export function readInviteLink(link: string | URL): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return new URLSearchParams(url.hash.slice(1)).get(inviteParameter);
  } catch {
    return null;
  }
}

/** Call during the click or submit event, even if the offer is still being gathered. */
export async function copyInviteLink(link: Promise<string | undefined>): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    if (typeof ClipboardItem === 'function' && typeof navigator.clipboard.write === 'function') {
      const type = 'text/plain';
      const text = link.then((value) => {
        if (!value) throw new Error('Invite canceled');
        return new Blob([value], { type });
      });
      // Some browsers can reject the write before reading the deferred clipboard data.
      void text.catch(() => {});
      await navigator.clipboard.write([new ClipboardItem({ [type]: text })]);
    } else {
      const value = await link;
      if (!value) return false;
      await navigator.clipboard.writeText(value);
    }
    return true;
  } catch {
    return false;
  }
}

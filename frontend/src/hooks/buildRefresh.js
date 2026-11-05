export function buildRefreshUrl(href, version) {
  const url = new URL(href);
  url.searchParams.set("_ls_build", version);
  return url.href;
}

export function cleanBuildRefreshUrl(href) {
  const url = new URL(href);
  url.searchParams.delete("_ls_build");
  return url.href;
}

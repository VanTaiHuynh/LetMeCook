const PUBLIC_SITE_ASSETS = "/storage/v1/object/public/site-assets/";

export function siteAsset(path) {
  return PUBLIC_SITE_ASSETS + path.split("/").map(encodeURIComponent).join("/");
}

export const sunnyChef = siteAsset("brand/sunnythechef.png");
export const sunnyThumbsUp = siteAsset("brand/sunnythumbsup.png");
export const sunnyWelcome = siteAsset("brand/sunnywelcome.png");
export const navbarLogo = siteAsset("brand/navbarlogo.png");
export const chefHat = siteAsset("brand/chef-hat.png");
export const heart = siteAsset("brand/heart.png");
export const error401 = siteAsset("brand/401error.png");
export const error403 = siteAsset("brand/403error.png");
export const error404 = siteAsset("brand/404.png");

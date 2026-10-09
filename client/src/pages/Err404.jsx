import { RecoveryPage } from '../components/InformationPages';
import { error404 as errImage } from "../utils/siteAsset";

export default function Err404() {
  return <RecoveryPage code="404" title="We couldn’t find that page" image={errImage} primaryTo="/recipes" primaryLabel="Explore recipes">
    The page you are looking for does not exist. Please check the URL or return to the homepage.
  </RecoveryPage>;
}

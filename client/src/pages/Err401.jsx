import { RecoveryPage } from '../components/InformationPages';
import { error401 as errImage } from "../utils/siteAsset";

export default function Err401() {
  return <RecoveryPage code="401" title="Log in to continue" image={errImage} primaryTo="/login" primaryLabel="Log in">
    You do not have permission to view this page. Please log in to access this content.
  </RecoveryPage>;
}

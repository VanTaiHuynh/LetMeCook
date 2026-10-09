import { RecoveryPage } from '../components/InformationPages';
import { error403 as errImage } from "../utils/siteAsset";

export default function Err403() {
  return <RecoveryPage code="403" title="This page is unavailable to you" image={errImage} primaryTo="/dashboard" primaryLabel="Go to my dashboard" secondaryTo="/contact" secondaryLabel="Contact support">
    You do not have permission to view this page. Please contact support if you believe this is an error.
  </RecoveryPage>;
}

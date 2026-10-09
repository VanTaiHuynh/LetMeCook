import { PolicyDocument } from '../components/InformationPages';

const sections = [
  { id: 'terms-use-of-the-website', title: 'Use of the Website', body: <>
<p>
          You agree to use this site responsibly and ethically. You must not engage
          in any activity that disrupts, damages, or interferes with the website,
          its services, or other users. Unauthorized use may give rise to claims
          or be a criminal offense.
        </p>
  </> },
  { id: 'terms-intellectual-property', title: 'Intellectual Property', body: <>
<p>
          Recipes and photos may come from third-party sources. Individual recipe pages
          show available source, author and rights information. You may not reproduce, distribute, or create derivative works
          without explicit permission.
        </p>
  </> },
  { id: 'terms-content-accuracy', title: 'Content Accuracy', body: <>
<p>
          While we strive for accurate, up-to-date information, all content is provided
          “as is” without warranties. We’re not responsible for errors or omissions.
        </p>
  </> },
  { id: 'terms-third-party-links', title: 'Third-Party Links', body: <>
<p>
          Our site may link to third-party websites. We do not endorse nor assume responsibility
          for any third-party content or privacy practices.
        </p>
  </> },
  { id: 'terms-limitation-of-liability', title: 'Limitation of Liability', body: <>
<p>
          Let Me Cook is not liable for any damages arising from the use or inability
          to use the site or services, including indirect or consequential damages.
        </p>
  </> },
  { id: 'terms-data-collection-and-privacy', title: 'Data Collection & Privacy', body: <>
<p>
          By using our services, you consent to our collection and use of your data as outlined
          in our Privacy Policy.
        </p>
  </> },
  { id: 'terms-changes-to-terms', title: 'Changes to Terms', body: <>
<p>
          We may modify these terms at any time. Continued use signifies acceptance of updates.
        </p>
  </> },
  { id: 'terms-governing-law', title: 'Governing Law', body: <>
<p>
          These terms are governed by the laws of the jurisdiction where Let Me Cook operates.
        </p>
  </> }
];

export default function Terms() {
  return <PolicyDocument title="Terms & Conditions" intro={<>Welcome to Let Me Cook! By accessing or using our website, you agree to comply
          with and be bound by the following terms and conditions.</>} topId="terms-top" sections={sections} />;
}

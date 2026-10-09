import { PolicyDocument } from '../components/InformationPages';

const sections = [
  { id: 'privacy-information-we-collect', title: 'Information We Collect', body: <>
<ul>
        <li>
          <strong>Personal Information:</strong> We collect your name, email address, profile information, cooking preferences, and dietary restrictions when you create an account or fill out forms on our site.
        </li>
        <li>
          <strong>Account Activity:</strong> Account features record favourites, dislikes, reviews and recipe browsing history.
        </li>
        <li>
          <strong>Kitchen Records:</strong> Saved meal plans, shopping checkmarks, pantry lots and observed prices are stored for the personal or household kitchen you select. Household memberships, invitations, cooking session steps, timers, submitted questions and answers, and confirmed stock consumption are also saved.
        </li>
        <li>
          <strong>Messages and Subscriptions:</strong> The Contact form stores your name, email and message in the local team inbox. Newsletter subscriptions store your email, consent and confirmation or unsubscribe status.
        </li>
        <li>
          <strong>Browser Storage:</strong> Your browser stores the sign-in session so you can remain signed in after reloading the site. Public guest meal-plan drafts can be kept in this browser tab during sign-in; account and pantry plans are not stored as guest drafts.
        </li>
      </ul>
  </> },
  { id: 'privacy-how-we-use-your-information', title: 'How We Use Your Information', body: <>
<ul>
        <li>To support your account, saved recipes, reviews and browsing history.</li>
        <li>To monitor, fix, and improve our website's performance and usability.</li>
        <li>To tailor recipe recommendations and content based on your preferences.</li>
        <li>To keep your chosen kitchen records and share household records with accepted members according to their access role.</li>
      </ul>
  </> },
  { id: 'privacy-data-storage-and-security', title: 'Data Storage and Security', body: <>
<p>
        Account and recipe data are stored in the local Supabase database. Account features use authentication and database access rules to control access to personal records.
      </p>
  </> },
  { id: 'privacy-ai-and-data-usage', title: 'AI and Data Usage', body: <>
<p>
        Sunny processes the text and photos you submit using models hosted on this local system. It uses your request and confirmed ingredients to find recipes in the collection. Saved profile preferences are not automatically included in Sunny searches; include any dietary needs or exclusions in your request. Account recommendations can use saved preferences and recipe activity.
      </p>
      <p>
        The meal planner can use your saved preferences, allergies, favourites and selected pantry when you enable those options. Cook-along questions use the session’s saved source instructions. Microphone access starts only when you choose to record: audio is transcribed locally, and you can edit the transcript before submitting it as a question. Requested step audio is generated locally. Saved cooking records contain submitted questions and answers, not microphone recordings.
      </p>
  </> },
  { id: 'privacy-optional-cooking-evidence', title: 'Optional Cooking Evidence', body: <>
<p>
        Evidence recording requires your personal opt-in. Analytics events are retained for 90 days: expired events are excluded from counts and exports immediately and physically removed in scheduled batches. Metrics count confirmations recorded with consent, while the actor’s current consent is still enabled. Recent cooking activity covers retained events. A named household observation starts only when its owner explicitly confirms enrollment with evidence consent enabled. Its anchor is fixed: week 4 is UTC days 22–28 after enrollment, and no retention rate is available before 28 elapsed days. Shared enrollment metadata expires 90 days after enrollment. Withdrawal, loss of required consent or deletion of linked personal evidence makes that observation unavailable or incomplete; it does not silently restart the observation. Deleting your evidence removes your events and actor link, while an incomplete shared marker can remain until its original expiry. The Evidence Console shows the measured period and denominator. You can export your own retained events, turn recording off or delete your own evidence events and revoke consent there. Analytics expiry and deletion do not delete cooking sessions, recipes, meal plans, pantry or household records.
      </p>
  </> },
  { id: 'privacy-recipe-database-sources', title: 'Recipe Database Sources', body: <>
<p>
        The collection includes user submissions and imported recipes. Imported recipe pages link to the original recipe and photo sources and show available author and rights information. Ingredient data and photo recognition can be incomplete; search results do not guarantee allergy safety.
      </p>
  </> },
  { id: 'privacy-third-party-services', title: 'Third-Party Services', body: <>
<p>
        This deployment uses local Supabase services for accounts, data and uploaded images. Some interface fonts are loaded from external font providers. Opening recipe source links takes you to external websites. Contact submissions are stored in the local team inbox rather than sent as external email. Newsletter confirmation and update emails are captured in the local test inbox in this installation.
      </p>
  </> },
  { id: 'privacy-your-rights', title: 'Your Rights', body: <>
<ul>
        <li>You may request access to the personal data we store about you.</li>
        <li>You can ask us to update or delete your information.</li>
        <li>You may withdraw consent for data processing when applicable.</li>
      </ul>
      <p>
        For account data requests, contact the person operating this local deployment or use the <a href="/contact">Contact page</a> to save a message in the local team inbox.
      </p>
  </> },
  { id: 'privacy-children-s-privacy', title: 'Children’s Privacy', body: <>
<p>
        Let Me Cook is not intended for children under 13. We do not knowingly collect data from children. If we learn that a child has submitted personal information, we will delete it immediately.
      </p>
  </> },
  { id: 'privacy-changes-to-this-policy', title: 'Changes to This Policy', body: <>
<p>
        We may update this Privacy Policy periodically to reflect changes in law, technology, or services. Updates will be posted on this page with a revised effective date.
      </p>
  </> },
  { id: 'privacy-contact-us', title: 'Contact Us', body: <>
<p>
        Have questions or concerns about your privacy? Please don’t hesitate to reach out through our <a href="/contact">Contact page</a>.
      </p>
  </> }
];

export default function Privacy() {
  return <PolicyDocument title="Privacy Policy" intro={<>At <strong>Let Me Cook</strong>, your privacy and security are important to us. This Privacy Policy explains what information we collect, how we use it, and the steps we take to protect it.</>} topId="privacy-top" sections={sections} />;
}

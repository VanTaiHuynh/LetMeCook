export const kitchenJourney = [
  { title: 'Find your kind of meal', description: 'Start with your tastes, your ingredients or a photo. Let Sunny help with the dinner decision.', path: '/sunny', cta: 'Ask Sunny' },
  { title: 'Make a week of it', description: 'Bring dinners, portions and the ingredients to buy into one plan that fits your week.', path: '/meal-planner', cta: 'Plan your week' },
  { title: 'Enjoy the cooking', description: 'Keep your place with spoken steps, useful timers and a little help when you need it.', path: '/how-it-works#cook', cta: 'See how it works' },
];

export const experienceHighlights = [
  { title: 'Ideas for your tastes', description: 'More of what you love to eat.', id: 'discover' },
  { title: 'Start with a photo', description: 'Turn ingredients into dinner inspiration.', id: 'discover' },
  { title: 'Flexible meal plans', description: 'A week that changes with you.', id: 'plan' },
  { title: 'A clearer shopping list', description: 'Bring what is missing into one list.', id: 'shop' },
  { title: 'Voice and cooking timers', description: 'Follow the recipe at your pace.', id: 'cook' },
  { title: 'Leftovers and ingredient swaps', description: 'Make more of what is on hand.', id: 'your-kitchen' },
];

export const featureStories = [
  {
    id: 'discover', title: 'Dinner ideas that feel like you.',
    description: 'Some nights you want comfort. Others call for something new. Sunny brings your tastes, your time and your ingredients into the conversation.',
    details: [
      { title: 'Taste-led inspiration', text: 'Meal ideas around the flavors, cuisines and cooking styles you enjoy.' },
      { title: 'Photo-to-meal ideas', text: 'Start with an ingredient photo, check what is in it and explore what to cook.' },
      { title: 'Your needs, in your words', text: 'Describe your time, portions and ingredients to include or leave out.' },
      { title: 'Clear recipe matches', text: 'See why a recipe fits and answer a short follow-up when Sunny needs a detail.' },
    ],
    path: '/sunny', cta: 'Find a meal with Sunny',
    example: { title: 'Example dinner request', quote: 'Something cozy with mushrooms and rice. Two people, about 25 minutes.', rows: [{ label: 'In the mood for', value: 'Comfort food' }, { label: 'On hand', value: 'Mushrooms, rice' }, { label: 'Tonight', value: 'Two people · 25 minutes' }], note: 'Start with a request like this, then choose the recipe that feels right.' },
  },
  {
    id: 'plan', title: 'A week with room for real life.',
    description: 'Build a dinner rhythm around busy nights, favorite meals and the people at your table. Change the plan when the week changes.',
    details: [
      { title: 'Weekly meal planning', text: 'Bring several dinners together around your preferences and the ingredients you have.' },
      { title: 'Easy what-if changes', text: 'Compare a shorter cooking time or another portion before choosing your plan.' },
      { title: 'Leftover inspiration', text: 'Give extra ingredients a place in another meal instead of another forgotten container.' },
      { title: 'Confirmed portions for another meal', text: 'Bring saved prepared leftovers into your plan and review the portions to reuse.' },
    ],
    path: '/meal-planner', cta: 'Make a dinner plan',
    example: { title: 'Example week', rows: [{ label: 'Monday', value: 'A quick bowl after work' }, { label: 'Wednesday', value: 'A family favorite' }, { label: 'Friday', value: 'A fresh idea for the weekend' }], note: 'Your week, your portions and your choice of dinners.' },
  },
  {
    id: 'shop', title: 'Know what to bring home.',
    description: 'Turn the dinners you choose into a shopping list. See your pantry alongside what is missing, so planning and shopping stay connected.',
    details: [
      { title: 'One grocery list', text: 'Bring ingredients across the plan together in one place.' },
      { title: 'Pantry-aware shopping', text: 'Review what is already in your kitchen before adding more.' },
      { title: 'A plan for your budget', text: 'Consider portions and the prices you record when deciding what to buy.' },
      { title: 'A list you can take with you', text: 'Copy, download or share your checked list with the kitchen you select.' },
    ],
    path: '/meal-planner', cta: 'Plan meals and groceries',
    example: { title: 'Example shopping check', rows: [{ label: 'Already at home', value: 'Rice and mushrooms' }, { label: 'Add to the list', value: 'Spring onions and stock' }, { label: 'Before shopping', value: 'Check amounts and portions' }], note: 'A clearer list begins with a pantry you have checked.' },
  },
  {
    id: 'cook', title: 'Sunny beside you, step by step.',
    description: 'Keep your attention on the food. A calm cooking companion helps you follow the recipe, manage the waits and find your place again.',
    details: [
      { title: 'Spoken recipe steps', text: 'Listen, pause or replay the current step when you choose.' },
      { title: 'Cooking timers and reminders', text: 'Keep track of the waits while you work through the recipe.' },
      { title: 'Help with the recipe', text: 'Ask about the step you are on and refer back to the recipe instructions.' },
      { title: 'Remember how dinner went', text: 'Confirm the cooked meal, record your taste feedback and save prepared leftovers.' },
    ],
    path: '/recipes', cta: 'Choose a recipe to cook',
    example: { title: 'Example cooking moment', quote: 'Read this step again while I prepare the ingredients.', rows: [{ label: 'Keep your place', value: 'One step at a time' }, { label: 'Your pace', value: 'Play, pause and replay' }, { label: 'While you wait', value: 'Review waits between steps' }], note: 'Choose individual steps or a timed reading flow. Pause whenever you need.' },
  },
];

export const kitchenExtras = [
  { title: 'A taste profile that grows with you', description: 'Favorite meals and feedback give your kitchen a more personal direction.', path: '/edit-profile', cta: 'Edit my food preferences' },
  { title: 'Meal planning as a conversation', description: 'Explore a different dinner direction with Sunny as your tastes, schedule and ideas change.', path: '/how-it-works#guide-sunny', cta: 'See how to ask Sunny' },
  { title: 'Thoughtful ingredient swaps', description: 'Explore another way to make a dish when an ingredient is missing or does not suit your preferences.', path: '/how-it-works#guide-plan', cta: 'Explore planning choices' },
  { title: 'Make more of what you have', description: 'Bring leftovers and ingredients that need using into the next dinner decision.', path: '/how-it-works#guide-after-cooking', cta: 'See how to reuse leftovers' },
  { title: 'Use-it-first reminders', description: 'Keep ingredients that need attention in mind when planning what to cook next.', path: '/pantry', cta: 'Review my pantry' },
  { title: 'One household, one kitchen', description: 'Bring shared ingredients, shopping and dinner choices together with the people you cook for.', path: '/household', cta: 'Open my household kitchen' },
  { title: 'Your own recipe collection', description: 'Keep favorites, add your recipes and return to meals you enjoyed.', path: '/favourites', cta: 'Open my favorites' },
  { title: 'Remember the good meals', description: 'Look back at dinners you cooked and bring the meals you enjoyed into another week.', path: '/how-it-works#guide-after-cooking', cta: 'Explore after-cooking tools' },
  { title: 'A place for food creators', description: 'Bring recipes and collections together around a creator’s cooking style.', path: '/creator', cta: 'Open creator workspace' },
];

export const gettingStarted = [
  { id: 'choose', title: 'Tell Sunny what sounds good.', description: 'Write what you want to eat, how much time you have and any ingredients to leave out. Or start with a photo and check the ingredient names.', tip: 'Try “A comforting dinner with mushrooms, for two, in 25 minutes.”', path: '/sunny', cta: 'Ask Sunny' },
  { id: 'week', title: 'Bring your week together.', description: 'Choose your dinners and portions. Review the plan, compare changes and keep the meals you want.', tip: 'A few planned dinners are a good place to start. Your whole week does not need to be decided at once.', path: '/meal-planner', cta: 'Open meal planner' },
  { id: 'groceries', title: 'Check your kitchen before shopping.', description: 'Review your pantry, add amounts you know and compare it with the ingredients in your plan. Use the shopping list for what is missing.', tip: 'Check quantities and pack sizes before you head to the store.', path: '/pantry', cta: 'Open your pantry' },
  { id: 'cook', title: 'Cook at your own pace.', description: 'Open Cook along inside a recipe. Listen step by step, or review the waits and let Timed flow read the next instruction automatically.', tip: 'Pause or replay a step whenever you need. Keep the recipe open while you cook.', path: '/recipes', cta: 'Find a recipe' },
];

export const kitchenQuestions = [
  { question: 'Where should I start?', answer: 'Ask Sunny for one meal or browse the recipe collection. You can explore first, then create an account to keep favorites and use your own kitchen.' },
  { question: 'Can I start with ingredients I already have?', answer: 'Yes. Name them in your request or start with an ingredient photo. Review the ingredient names before searching, and add amounts yourself when using your pantry.' },
  { question: 'How do I make the suggestions more personal?', answer: 'Describe the flavors and cuisines you enjoy, your available time and any ingredients to leave out. Save favorite recipes and update your preferences in your profile.' },
  { question: 'Can I change my meal plan?', answer: 'Yes. Review the meals, adjust portions or compare a what-if change before applying it. Check the shopping list again after changing the plan.' },
  { question: 'Do I have to use voice?', answer: 'No. The written recipe remains available. You choose when to start spoken guidance, pause it or replay a step.' },
  { question: 'What happens when a timer finishes?', answer: 'Cook along gives a timer cue while the page is active. Keep the page open and sound on to hear it; you can pause Timed flow or move through individual steps yourself.' },
  { question: 'Can I use LetMeCook with my household?', answer: 'A household kitchen brings pantry and shopping tasks into a shared space. Use the Household page to manage invitations and member access.' },
];

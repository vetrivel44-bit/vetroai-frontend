// Home-screen buttons that pick something for the user. "VetroAI's choice"
// used to send the fixed suggestion "Summarize a topic", so every click
// produced the same vague summary. Now each click draws a prompt from a
// varied pool, skipping the ones shown recently; "Life stuff" works the same.

export const VETRO_CHOICES = [
  // Science & space
  "Why is the sky blue but sunsets orange? Explain it like a curious friend would.",
  "What would happen to Earth if the Moon suddenly disappeared?",
  "How do black holes actually form, and what happens at the event horizon?",
  "Why do we dream? Walk me through what scientists currently think.",
  "How can tiny tardigrades survive in outer space?",
  "Explain quantum entanglement with an everyday analogy.",
  "Why does time pass slower near a massive object? Explain gravity's effect on time simply.",
  // History & culture
  "Tell me the story of how the Chola dynasty built a navy that reached Southeast Asia.",
  "What made the Brihadeeswarar Temple in Thanjavur an engineering marvel 1,000 years ago?",
  "How did the ancient Indus Valley cities manage drainage better than many modern towns?",
  "Tell me a lesser-known story from the Indian independence movement.",
  "How did the Silk Road change food, religion and ideas across continents?",
  "What was daily life like for a teenager in ancient Rome?",
  "Why did the Library of Alexandria matter so much, and what do we really know about its fate?",
  // Tech & the future
  "How does a large language model like you actually come up with the next word?",
  "What everyday technology will look completely different in 10 years?",
  "How does UPI move money between banks in under a second?",
  "Explain how GPS knows exactly where my phone is.",
  "What happens, step by step, when I type a website address and press Enter?",
  // Mind & life
  "What are the most useful mental models for making better decisions?",
  "Why do habits stick, and how can I build one that lasts?",
  "Teach me a memory technique I can use today, with a quick exercise.",
  "What does research say actually makes people happier?",
  "Give me a 10-minute daily routine to reduce stress, based on evidence.",
  "How can I learn any new skill faster? Give me a practical plan.",
  // Nature
  "How do octopuses think with arms that have their own neurons?",
  "How do migrating birds find their way across thousands of kilometres?",
  "Why are coral reefs called the rainforests of the sea, and why are they in trouble?",
  "What's the smartest animal you know about, and why?",
  // Fun & creative
  "Give me a tricky logic puzzle, and don't reveal the answer until I ask.",
  "Write a short mystery story set in Chennai with a twist ending.",
  "Tell me 5 surprising facts that sound fake but are true.",
  "Invent a new board game I can play with friends tonight using just paper and pens.",
  "Write a funny poem about a cat who thinks it runs the house.",
  "If you could add one new rule to cricket to make it more exciting, what would it be and why?",
  "Plan an imaginary 3-day trip to a place I've probably never heard of.",
  // Money & practical
  "Explain how compound interest works, and why starting early matters so much.",
  "What are the smartest ways for a student to start saving and investing?",
  "Teach me how to cook one impressive dish with simple ingredients.",
  "What are the first-aid basics everyone should know?",
];

// "Life stuff" used to send the fixed suggestion "Plan my week" every time.
export const LIFE_CHOICES = [
  // Planning & productivity
  "Help me plan a productive week with time for work, rest and exercise.",
  "Build me a realistic daily routine for studying 4 hours a day without burning out.",
  "Give me a simple system to stop procrastinating, with a first step I can take today.",
  "How can I organise my morning so I'm never rushing?",
  "Help me make a to-do list method that actually works for a busy person.",
  // Health & fitness
  "Create a 20-minute home workout I can do with no equipment.",
  "What's a healthy, cheap weekly meal plan for one person?",
  "How can I fix my sleep schedule in one week?",
  "Give me simple stretches for back pain from sitting all day.",
  "How much water, protein and sleep do I really need? Keep it practical.",
  // Food & home
  "Suggest a quick South Indian breakfast I can make in 15 minutes.",
  "What can I cook tonight with rice, eggs, onions and tomatoes?",
  "Give me a weekend deep-cleaning checklist for a small home.",
  "How do I keep houseplants alive if I keep forgetting to water them?",
  "Give me smart ways to cut my electricity bill this summer.",
  // Money
  "Help me make a simple monthly budget on a ₹30,000 salary.",
  "How do I build an emergency fund, step by step?",
  "What are common money mistakes people make in their 20s?",
  "Help me plan a birthday party on a small budget.",
  // People & feelings
  "How do I politely say no to people without feeling guilty?",
  "Give me tips to make conversation with new people at a party.",
  "How can I support a friend who's going through a hard time?",
  "How do I handle a disagreement with family calmly?",
  "Give me a 5-minute exercise to calm down when I'm anxious.",
  "Help me write a heartfelt thank-you message to my teacher.",
  // Travel & weekends
  "Plan a relaxing one-day weekend trip near Chennai.",
  "Give me a packing checklist for a 3-day trip.",
  "Suggest fun things to do at home on a rainy weekend.",
  "Plan a budget-friendly family outing for this Sunday.",
  // Growth
  "Help me pick a new hobby based on what I enjoy.",
  "Give me a 30-day plan to read more books.",
  "How can I reduce my screen time without feeling bored?",
  "Help me prepare for a job interview tomorrow.",
];

const RECENT_MAX = 15;

function readRecent(storage, key) {
  try { const list = JSON.parse(storage?.getItem(key) || "[]"); return Array.isArray(list) ? list : []; }
  catch { return []; }
}

// A random prompt from `choices`, different from the last few picks
// remembered under `key`. `random` and `storage` are injectable for tests.
function pickFrom(choices, key, { random = Math.random, storage = globalThis.localStorage } = {}) {
  const recent = readRecent(storage, key);
  const fresh = choices.filter((p) => !recent.includes(p));
  const pool = fresh.length ? fresh : choices;
  const pick = pool[Math.floor(random() * pool.length) % pool.length];
  try { storage?.setItem(key, JSON.stringify([pick, ...recent.filter((p) => p !== pick)].slice(0, RECENT_MAX))); }
  catch { /* storage blocked: still return a pick */ }
  return pick;
}

/** A prompt for "VetroAI's choice". */
export const pickVetroChoice = (options) => pickFrom(VETRO_CHOICES, "vetroai_choice_recent", options);

/** A prompt for "Life stuff". */
export const pickLifeChoice = (options) => pickFrom(LIFE_CHOICES, "vetroai_life_recent", options);

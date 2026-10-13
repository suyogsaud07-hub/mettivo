/** Demo fixtures for the MVP. Replaced by a real backend later. */

export interface Interest {
  id: string;
  label: string;
  icon?: string;
}

export interface Prompt {
  id: string;
  question: string;
  placeholder: string;
}

export interface UserProfile {
  id: string;
  name: string;
  age: number;
  city: string;
  intention: "friendship" | "dating" | "both";
  interests: string[]; // ids
  promptAnswers: { [key: string]: string };
  photos: string[];
  about: string;
  online: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: Date;
  status: "delivered" | "read";
}

export interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  unreadCount: number;
}

export const INTERESTS: Interest[] = [
  { id: "travel", label: "Travel" },
  { id: "food", label: "Foodie" },
  { id: "music", label: "Music" },
  { id: "hiking", label: "Hiking" },
  { id: "movies", label: "Movies" },
  { id: "fitness", label: "Fitness" },
  { id: "art", label: "Art" },
  { id: "gaming", label: "Gaming" },
  { id: "dogs", label: "Dogs" },
  { id: "coffee", label: "Coffee" },
  { id: "photography", label: "Photography" },
  { id: "yoga", label: "Yoga" },
];

export const PROMPTS: Prompt[] = [
  {
    id: "simple-pleasures",
    question: "My simple pleasures are...",
    placeholder: "Sunshine, freshly brewed coffee, that first page of a good book...",
  },
  {
    id: "geek-out",
    question: "I geek out on...",
    placeholder: "90s sitcoms, craft beer, and finding the perfect taco spot in every city...",
  },
  {
    id: "together",
    question: "Together, we could...",
    placeholder: "Explore hidden hiking trails, try every ramen shop downtown, plan spontaneous weekend trips...",
  },
];

export const MOCK_USERS: UserProfile[] = [
  {
    id: "u1",
    name: "Maya",
    age: 27,
    city: "San Francisco",
    intention: "dating",
    interests: ["travel", "food", "photography", "coffee"],
    promptAnswers: {
      "simple-pleasures": "Golden hour photos and coffee that doesn't burn my tongue.",
      "geek-out": "Finding the perfect espresso and indie record stores.",
      "together": "Road-tripping to coast-to-coast food festivals.",
    },
    photos: ["/next.svg"],
    about: "Photographer chasing light and good food.",
    online: true,
  },
  {
    id: "u2",
    name: "Jordan",
    age: 29,
    city: "Oakland",
    intention: "both",
    interests: ["hiking", "dogs", "music", "fitness"],
    promptAnswers: {
      "simple-pleasures": "Morning hikes, my golden retriever, and silence before the world wakes up.",
      "geek-out": "Outdoor gear, trail recipes, and live folk music.",
      "together": "Conquering a new trail each month and ending it with a campfire.",
    },
    photos: ["/next.svg"],
    about: "Adventure seeker and dog mom.",
    online: false,
  },
  {
    id: "u3",
    name: "Alex",
    age: 26,
    city: "Berkeley",
    intention: "friendship",
    interests: ["gaming", "movies", "coffee", "art"],
    promptAnswers: {
      "simple-pleasures": "Cozy game nights, museum days, and the third cup of coffee.",
      "geek-out": "Indie games, film buffs, and pixel art.",
      "together": "A movie marathon with all the right snacks.",
    },
    photos: ["/next.svg"],
    about: "Gamer, artist, and casual coffee snob.",
    online: true,
  },
  {
    id: "u4",
    name: "Priya",
    age: 28,
    city: "San Jose",
    intention: "dating",
    interests: ["travel", "yoga", "food", "hiking"],
    promptAnswers: {
      "simple-pleasures": "Sunrise yoga, spice markets, and slow Sundays.",
      "geek-out": "Plant-based recipes and wellness retreats.",
      "together": "Traveling to a new country every year.",
    },
    photos: ["/next.svg"],
    about: "Wellness enthusiast and world traveler.",
    online: false,
  },
  {
    id: "u5",
    name: "Sam",
    age: 30,
    city: "San Francisco",
    intention: "both",
    interests: ["food", "music", "art", "coffee"],
    promptAnswers: {
      "simple-pleasures": "Street food, vinyl spinning, and art gallery openings.",
      "geek-out": "Hidden speakeasies and local jazz scenes.",
      "together": "Craze through the city's best restaurants together.",
    },
    photos: ["/next.svg"],
    about: "Music lover and urban explorer.",
    online: true,
  },
];

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "c1",
    userId: "u1",
    unreadCount: 2,
    messages: [
      {
        id: "m1",
        senderId: "u1",
        text: "Hey! I saw you like photography too 📸",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
        status: "read",
      },
      {
        id: "m2",
        senderId: "me",
        text: "Hi Maya! Yes, I shoot mostly street photography. What about you?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 1.5),
        status: "read",
      },
      {
        id: "m3",
        senderId: "u1",
        text: "Same! We should swap tips sometime ☕",
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
        status: "delivered",
      },
      {
        id: "m4",
        senderId: "u1",
        text: "Also — that coffee shop in the Mission?",
        timestamp: new Date(Date.now() - 1000 * 60 * 10),
        status: "delivered",
      },
    ],
  },
  {
    id: "c2",
    userId: "u4",
    unreadCount: 0,
    messages: [
      {
        id: "m5",
        senderId: "u4",
        text: "Namaste! Love your hiking photos 🧘",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
        status: "read",
      },
      {
        id: "m6",
        senderId: "me",
        text: "Thanks Priya! Have you been to Yosemite?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 20),
        status: "read",
      },
    ],
  },
];

export const CURRENT_USER_ID = "me";

// Personalities (Pokemon natures): +10% to one stat and -10% to another, one for every ordered
// pair of the five battle stats (20), plus one neutral. Names are hamster moods, not nature names.
import type { PersonalityDef } from './schema.ts';

export const PERSONALITIES: PersonalityDef[] = [
  { id: 'easygoing', name: 'Easygoing', up: null, down: null, blurb: 'Happy with whatever is in the bowl.' },

  // ATTACK up
  { id: 'bitey', name: 'Bitey', up: 'atk', down: 'def', blurb: 'Nibbles first and worries about the bruises later.' },
  { id: 'scrappy', name: 'Scrappy', up: 'atk', down: 'spa', blurb: 'Would much rather wrestle than think about it.' },
  { id: 'grumpy', name: 'Grumpy', up: 'atk', down: 'spd', blurb: 'Rattles the cage bars when breakfast is late.' },
  { id: 'chonky', name: 'Chonky', up: 'atk', down: 'spe', blurb: 'Hits like a dumpling falling off a very high shelf.' },

  // DEFENSE up
  { id: 'cuddly', name: 'Cuddly', up: 'def', down: 'atk', blurb: 'Would rather snuggle than scrap.' },
  { id: 'stubborn', name: 'Stubborn', up: 'def', down: 'spa', blurb: 'Plants all four paws and simply refuses to budge.' },
  { id: 'crunchy', name: 'Crunchy', up: 'def', down: 'spd', blurb: 'Crunchy on the outside, squishy on the inside.' },
  { id: 'snacky', name: 'Snacky', up: 'def', down: 'spe', blurb: 'Too full of snacks to run, too padded to feel a bonk.' },

  // SP. ATK up
  { id: 'dreamy', name: 'Dreamy', up: 'spa', down: 'atk', blurb: 'Spends all day dreaming up big, sparkly ideas.' },
  { id: 'sparky', name: 'Sparky', up: 'spa', down: 'def', blurb: 'Full of bright ideas and very easily bruised.' },
  { id: 'cheeky', name: 'Cheeky', up: 'spa', down: 'spd', blurb: 'Clever, cheeky, and terrible at taking a joke.' },
  { id: 'bookish', name: 'Bookish', up: 'spa', down: 'spe', blurb: 'Reads every word on the snack label. Slowly.' },

  // SP. DEF up
  { id: 'sweet', name: 'Sweet', up: 'spd', down: 'atk', blurb: 'Shares its seeds with absolutely everyone.' },
  { id: 'mellow', name: 'Mellow', up: 'spd', down: 'def', blurb: 'Shrugs off rude words, but not bonks on the head.' },
  { id: 'cozy', name: 'Cozy', up: 'spd', down: 'spa', blurb: 'Happiest in a warm sock drawer with a good snack.' },
  { id: 'sleepy', name: 'Sleepy', up: 'spd', down: 'spe', blurb: 'Naps straight through thunderstorms.' },

  // SPEED up
  { id: 'skittish', name: 'Skittish', up: 'spe', down: 'atk', blurb: 'Darts away at the sound of a crinkly bag.' },
  { id: 'zoomy', name: 'Zoomy', up: 'spe', down: 'def', blurb: 'Races everyone to the food bowl and trips over it.' },
  { id: 'fidgety', name: 'Fidgety', up: 'spe', down: 'spa', blurb: 'Cannot sit still long enough to finish a thought.' },
  { id: 'hyper', name: 'Hyper', up: 'spe', down: 'spd', blurb: 'Ran on the wheel all night. Again.' },
];

// The words short links are made of: one from each list, "GreedyFelMurloc". Any lengths will do —
// card.js picks by remainder — and between them they make about 890,000 names, which is what keeps
// two links from wanting the same one. Whole words only, each capitalised once, so a name splits
// back into its words (`SLUG` in card.js); and nothing about the playable races, since a random
// adjective lands on whatever noun it lands on.
//
// Changing a list renames every link minted afterwards, but never one already minted: a link's
// words are stored with it, not worked out again.

/** @param {string} s */
function words(s) {
  return s.trim().split(/\s+/);
}

export const ADJECTIVES = words(`
  Bashful Bold Bouncy Brave Breezy Brisk Bubbly Burly Calm Chatty Cheeky Chilly Chirpy Clever
  Clumsy Cozy Crafty Cranky Crisp Cunning Curious Dapper Daring Dashing Dizzy Dusty Eager Fancy
  Feisty Fickle Fierce Fizzy Fluffy Frantic Fuzzy Gentle Giddy Gloomy Glum Greedy Grim Grizzled
  Grumpy Gutsy Handy Hardy Hasty Hearty Hollow Humble Hungry Itchy Jaunty Jolly Jumbo Jumpy Keen
  Lanky Lavish Lazy Lively Lofty Loud Loyal Lucky Lumpy Mellow Merry Mighty Misty Moody Musty
  Nifty Nimble Noble Nosy Odd Peppy Perky Pesky Plucky Polite Prickly Proud Puny Quick Quiet
  Quirky Rowdy Rugged Rusty Salty Sassy Scrappy Shiny Shy Silly Sleepy Sly Smug Snappy Sneaky
  Sneezy Snug Soggy Sour Speedy Spicy Spiffy Spooky Spunky Steady Sticky Stoic Stout Stubborn
  Sturdy Sunny Swift Thrifty Tidy Tiny Tough Trusty Twitchy Wacky Weary Wiggly Wily Wise Witty
  Wobbly Zany Zesty
`);

export const ELEMENTS = words(`
  Amber Arcane Ash Azure Bronze Celestial Chrono Cinder Copper Coral Crimson Crystal Dawn Dusk
  Earthen Elite Ember Emerald Epic Ethereal Fel Feral Fire Frost Gilded Glacial Golden Heroic Holy
  Iron Jade Lunar Mithril Molten Moonlit Mossy Mythic Nether Obsidian Onyx Phantom Primal Radiant
  Ruby Runic Sandy Sapphire Shadow Silver Solar Spectral Starlit Storm Thorium Thorny Thunder
  Tidal Twilight Venom Void Wild
`);

export const CREATURES = words(`
  Arakkoa Banshee Barrel Basilisk Bat Bear Beaver Beetle Bison Boar Candle Cat Cauldron Centaur
  Chicken Clefthoof Crab Crane Crate Crocolisk Dragonfly Dragonhawk Drake Dryad Elekk Faerie
  Felhound Firefly Flamingo Fox Frog Furbolg Gargoyle Ghoul Gnoll Golem Gorloc Grell Gronn Gryphon
  Harpy Hearthstone Hedgehog Heron Hippogryph Hozen Hydra Hyena Imp Jinyu Kobold Kodo Lantern
  Locust Lynx Mammoth Mantid Mole Moonkin Moose Moth Murloc Naga Netherray Ogre Ooze Otter Owl
  Owlkin Panther Parrot Peacock Penguin Porcupine Quilboar Rabbit Raptor Rat Ravager Rhino
  Riverbeast Rylak Satyr Saurok Scorpid Seal Silithid Snail Snake Spider Sprite Squirrel Stag
  Talbuk Tiger Toad Tortollan Totem Treant Turtle Vulture Walrus Whelp Wisp Wolf Wraith Wyvern Yak
  Yeti
`);

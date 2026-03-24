/**
 * locations.js
 * Shoulders of Giants — Location Data
 *
 * Each location object contains:
 *   id          {number}  Unique location identifier
 *   name        {string}  Display name of the location
 *   region      {string}  Region subtitle shown on the location tile
 *   abilityText {string}  Plain-English description of the location's ability
 *   abilityKey  {string}  Machine-readable key used by game.js to apply the ability effect
 *
 * Ability keys and their effects (implemented in game.js):
 *
 *   "MILITARY_FREE_MOVE_AWAY"
 *       Scandinavia — Military cards may move away from this location at no capital cost.
 *
 *   "FIRST_CARD_HERE"
 *       The Great Rift Valley — Each player must play their very first card of the game
 *       to this location (enforced during the selection phase of Turn 1).
 *
 *   "MOVE_IN_GAINS_IP"
 *       The Cape of Good Hope — Any card that moves TO this location gains +1 IP
 *       (applied at the moment the move is executed during the reveal phase).
 *
 *   "RELIGIOUS_DISCOUNT"
 *       The Levant — Religious cards cost 1 less Capital (minimum 1) to play here.
 *
 *   "CULTURAL_FREE_MOVE_HERE"
 *       Timbuktu — Cultural cards may move TO this location at no capital cost.
 *
 * Three of these five locations are randomly selected at the start of each game.
 * Selection logic lives in game.js.
 */

const LOCATIONS = [
  {
    id: 1,
    name: "Scandinavia",
    region: "Fjordlandia",
    abilityText: "Military cards can freely move away from here.",
    abilityKey: "MILITARY_FREE_MOVE_AWAY"
  },
  {
    id: 2,
    name: "The Great Rift Valley",
    region: "Cradle of Humanity",
    abilityText: "You must play your first card of the game here.",
    abilityKey: "FIRST_CARD_HERE"
  },
  {
    id: 3,
    name: "The Cape of Good Hope",
    region: "Waypoint",
    abilityText: "When a card moves here it gains +1 IP.",
    abilityKey: "MOVE_IN_GAINS_IP"
  },
  {
    id: 4,
    name: "The Levant",
    region: "Monotheism",
    abilityText: "Religious cards cost -1 CC to play here.",
    abilityKey: "RELIGIOUS_DISCOUNT"
  },
  {
    id: 5,
    name: "Timbuktu",
    region: "Beacon of Culture",
    abilityText: "Cultural cards can freely move here.",
    abilityKey: "CULTURAL_FREE_MOVE_HERE"
  }
];

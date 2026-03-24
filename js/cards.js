/**
 * cards.js
 * Shoulders of Giants — Card Data
 *
 * Each card object contains:
 *   id         {number}      Unique card identifier
 *   name       {string}      Display name (also used as image filename, e.g. "Joan of Arc.png")
 *   cc         {number}      Capital Cost — the cost to play this card
 *   ip         {number}      Influence Points — base scoring value
 *   type       {string}      Card type: "Political" | "Religious" | "Military" | "Cultural" | "Exploration"
 *   era        {string|null} Historical era label (null if not era-specific)
 *   abilityName{string|null} Short name for the card's ability (null for vanilla cards)
 *   ability    {string|null} Full ability description (null for vanilla cards)
 *
 * Ability trigger keywords (used by the ability engine in game.js):
 *   "At Once"       — fires immediately when the card is revealed
 *   "Continuous"    — passive, re-evaluated whenever board state changes
 *   "If / When"     — conditional, fires when the described event occurs
 */

const CARDS = [

  // ─── POLITICAL ────────────────────────────────────────────────────────────
  {
    id: 1,
    name: "Citizens",
    cc: 1,
    ip: 1,
    type: "Political",
    era: "Rome",
    abilityName: null,
    ability: null
  },
  {
    id: 2,
    name: "Scholar-Officials",
    cc: 2,
    ip: 1,
    type: "Political",
    era: "China",
    abilityName: "Civil Service",
    ability: "At Once: For every other card you have here, Scholar-Officials gain +1 Capital next turn."
  },
  {
    id: 3,
    name: "Justinian",
    cc: 3,
    ip: 3,
    type: "Political",
    era: "Rome",
    abilityName: "Code of Justinian",
    ability: "At Once: Justinian resets all cards here back to their original IP."
  },
  {
    id: 4,
    name: "Empress Wu",
    cc: 4,
    ip: 4,
    type: "Political",
    era: "China",
    abilityName: "Iron Fist",
    ability: "At Once: Empress Wu pushes the Political or Military card with the highest IP away from here, if she can't, she destroys it."
  },
  {
    id: 5,
    name: "Pacal the Great",
    cc: 5,
    ip: 5,
    type: "Political",
    era: "Mesoamerica",
    abilityName: "Temple of Inscriptions",
    ability: "At Once: Pacal triggers the 'At Once' abilities of all your cards at this location."
  },

  // ─── RELIGIOUS ────────────────────────────────────────────────────────────
  {
    id: 6,
    name: "Priests",
    cc: 1,
    ip: 1,
    type: "Religious",
    era: null,
    abilityName: null,
    ability: null
  },
  {
    id: 7,
    name: "Jan Hus",
    cc: 2,
    ip: 1,
    type: "Religious",
    era: "Reformation",
    abilityName: "Martyr for Reform",
    ability: "If Jan Hus is discarded, he gives all your cards currently in play +1 IP."
  },
  {
    id: 8,
    name: "Francis of Assisi",
    cc: 3,
    ip: 4,
    type: "Religious",
    era: "Middle Ages",
    abilityName: "Vow of Poverty",
    ability: "At Once: Francis of Assisi discards the highest cost Religious card in your hand."
  },
  {
    id: 9,
    name: "Erasmus",
    cc: 4,
    ip: 3,
    type: "Religious",
    era: "Reformation",
    abilityName: "On Free Will",
    ability: "At Once: Erasmus allows you to choose any card from your hand to discard."
  },
  {
    id: 10,
    name: "Jesus Christ",
    cc: 5,
    ip: 5,
    type: "Religious",
    era: "Early Christianity",
    abilityName: "King of Martyrs",
    ability: "If Jesus is discarded, he gains +3 IP and returns to your hand."
  },

  // ─── MILITARY ─────────────────────────────────────────────────────────────
  {
    id: 11,
    name: "Knight",
    cc: 1,
    ip: 1,
    type: "Military",
    era: "Middle Ages",
    abilityName: null,
    ability: null
  },
  {
    id: 12,
    name: "Samurai",
    cc: 2,
    ip: 2,
    type: "Military",
    era: "Japan",
    abilityName: "Bushido Code",
    ability: "Any time the Samurai is destroyed, it gains +2 IP and returns to the same location."
  },
  {
    id: 13,
    name: "Hernan Cortes",
    cc: 3,
    ip: 3,
    type: "Military",
    era: "Age of Exploration",
    abilityName: "Conquistador",
    ability: "At Once: Cortes destroys all of your cards at this location and gains +1 IP for each one destroyed."
  },
  {
    id: 14,
    name: "Joan of Arc",
    cc: 4,
    ip: 4,
    type: "Military",
    era: "Middle Ages",
    abilityName: "Maid of Orleans",
    ability: "If Joan of Arc is destroyed, she summons a Religious card from your hand."
  },
  {
    id: 15,
    name: "William the Conqueror",
    cc: 5,
    ip: 1,
    type: "Military",
    era: "Middle Ages",
    abilityName: "The Norman Conquest",
    ability: "Continuous: Accumulates the IP from all cards you destroyed this game."
  },

  // ─── CULTURAL ─────────────────────────────────────────────────────────────
  {
    id: 16,
    name: "Griots",
    cc: 1,
    ip: 1,
    type: "Cultural",
    era: "West African Societies",
    abilityName: null,
    ability: null
  },
  {
    id: 17,
    name: "Kente",
    cc: 2,
    ip: 2,
    type: "Cultural",
    era: "West African Societies",
    abilityName: "Woven Heritage",
    ability: "Continuous: Kente prevents all cards here from being destroyed."
  },
  {
    id: 18,
    name: "Juvenal",
    cc: 3,
    ip: 3,
    type: "Cultural",
    era: "Rome",
    abilityName: "Satire",
    ability: "Continuous: Juvenal reduces all 4 and 5 CC cards here by -2 IP."
  },
  {
    id: 19,
    name: "Cosimo de'Medici",
    cc: 4,
    ip: 4,
    type: "Cultural",
    era: "Renaissance",
    abilityName: "Patron of the Arts",
    ability: "Continuous: Cosimo de\u2019Medici reduces your cost to play Cultural cards by -1."
  },
  {
    id: 20,
    name: "Voltaire",
    cc: 5,
    ip: 5,
    type: "Cultural",
    era: "Enlightenment",
    abilityName: "Candide",
    ability: "Continuous: If Voltaire is your only card here, he receives +4 IP."
  },

  // ─── EXPLORATION ──────────────────────────────────────────────────────────
  {
    id: 21,
    name: "Nomad",
    cc: 1,
    ip: 1,
    type: "Exploration",
    era: "Islamic Empires",
    abilityName: null,
    ability: null
  },
  {
    id: 22,
    name: "Henry the Navigator",
    cc: 2,
    ip: 1,
    type: "Exploration",
    era: "Age of Exploration",
    abilityName: "Navigation Patron",
    ability: "Continuous: Henry reduces your cost of playing Exploration cards at this location by -1."
  },
  {
    id: 23,
    name: "Zheng He",
    cc: 3,
    ip: 1,
    type: "Exploration",
    era: "China",
    abilityName: "Treasure Fleet",
    ability: "At Once: Zheng He delivers +2 IP to 1 card at each adjacent location."
  },
  {
    id: 24,
    name: "Magellan",
    cc: 4,
    ip: 4,
    type: "Exploration",
    era: "Age of Exploration",
    abilityName: "Circumnavigation",
    ability: "Magellan can move each turn and gains +1 IP with each move."
  },
  {
    id: 25,
    name: "Christopher Columbus",
    cc: 5,
    ip: 5,
    type: "Exploration",
    era: "Age of Exploration",
    abilityName: "Columbian Exchange",
    ability: "Columbus can move once on his own. When he arrives at a new location, he reduces your opponent's Cultural cards at that location by -1 IP."
  }

];

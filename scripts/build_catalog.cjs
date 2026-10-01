// Builds the storefront catalog (assets/catalog.js, single-vial prices) and the
// wholesale catalog (the PRODUCTS block in wholesale.html, 1/10/25 tiers) from
// the parsed price sheet (scripts/price-sheet.json: SKU → { "1", "10", "25" }).
//
//   node scripts/build_catalog.cjs [path/to/price-sheet.json]
//
// Every SKU in the sheet must map to a product below, or the build stops.
// Products that already exist keep their photo, purity and lot; new products
// get the placeholder image and no purity or lot (none is invented).
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sheet = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, "price-sheet.json"), "utf8"));
const PLACEHOLDER = "assets/images/studio/catalog/placeholder.svg";

// Groups in display order. `filter` is the storefront filter key; `wholesale`
// is the section title in the wholesale portal.
const GROUPS = {
  glp1: { cat: "GLP-1 Research Peptides", wholesale: "GLP-1s", filter: "GLP-1" },
  repair: { cat: "Repair & Recovery Peptides", wholesale: "Repair & Recovery", filter: "Repair" },
  ghs: { cat: "Growth Hormone Secretagogues", wholesale: "Growth Hormone Secretagogues", filter: "GHS" },
  growth: { cat: "Growth Factors", wholesale: "Growth Factors", filter: "Growth" },
  metabolic: { cat: "Metabolic & Mitochondrial", wholesale: "Metabolic & Mitochondrial", filter: "Metabolic" },
  neuro: { cat: "Neuropeptides", wholesale: "Neuropeptides", filter: "Neuro" },
  bioregulator: { cat: "Bioregulators & Immune Peptides", wholesale: "Bioregulators & Immune", filter: "Bioregulator" },
  hormone: { cat: "Reproductive & Melanocortin Peptides", wholesale: "Reproductive & Melanocortin", filter: "Hormone" },
  cosmetic: { cat: "Cosmetic Peptides", wholesale: "Cosmetic Peptides", filter: "Cosmetic" },
  blends: { cat: "Peptide Blends", wholesale: "Peptide Blends", filter: "Blends" },
  supplies: { cat: "Lab Supplies", wholesale: "Lab Supplies", filter: "Supplies" },
};

// Catalog order. `bases` are SKU prefixes (before -<dose>MG-<vol>ML);
// `plus` marks a base whose variants get a "<NAME>+ · " label prefix.
const PRODUCTS = [
  // GLP-1
  { id: "sema", group: "glp1", bases: ["GLP-1-1S"] },
  { id: "tirz", group: "glp1", bases: ["GLP-1-2T"] },
  { id: "reta", group: "glp1", bases: ["GLP-1-3R"] },
  { id: "cagri", group: "glp1", bases: ["GLP-1-C"], name: "Cagrilintide", molecule: "Amylin analog · Cagrilintide", wholesaleMolecule: "Amylin analog" },
  { id: "mazdu", group: "glp1", bases: ["GLP-1-1MZ"], name: "Mazdutide", molecule: "GLP-1 / glucagon · Mazdutide", wholesaleMolecule: "GLP-1 / glucagon dual agonist" },
  { id: "survo", group: "glp1", bases: ["GLP-1-SV"], name: "Survodutide", molecule: "GLP-1 / glucagon · Survodutide", wholesaleMolecule: "GLP-1 / glucagon dual agonist" },
  { id: "cagrisema", group: "glp1", bases: ["BLND-GLP-1-C1S"], name: "Cagrilintide / Semaglutide", molecule: "GLP-1 blend · Cagrilintide + Semaglutide", wholesaleMolecule: "Cagrilintide + Semaglutide" },
  { id: "cagrireta", group: "glp1", bases: ["BLND-GLP-1-C3R"], name: "Cagrilintide / Retatrutide", molecule: "GLP-1 blend · Cagrilintide + Retatrutide", wholesaleMolecule: "Cagrilintide + Retatrutide" },
  // Repair & recovery
  { id: "bpc", group: "repair", bases: ["BPC157"] },
  { id: "ghk", group: "repair", bases: ["GHKCU"] },
  { id: "tb500", group: "repair", bases: ["TB500"], name: "TB-500", molecule: "Thymosin β4 fragment · TB-500", wholesaleMolecule: "Thymosin β4 fragment" },
  { id: "kpv", group: "repair", bases: ["KPV"], name: "KPV", molecule: "Tripeptide · KPV", wholesaleMolecule: "Tripeptide (Lys-Pro-Val)" },
  { id: "ara290", group: "repair", bases: ["ARA290"], name: "ARA-290", molecule: "Research peptide · ARA-290", wholesaleMolecule: "Research peptide" },
  // Growth hormone secretagogues
  { id: "ipa", group: "ghs", bases: ["IPAMORELIN"] },
  { id: "cjc-nodac", group: "ghs", bases: ["CJC1295"] },
  { id: "cjc-dac", group: "ghs", bases: ["BLND-CJC1295WITHDAC"] },
  { id: "ser", group: "ghs", bases: ["SERMORELIN"] },
  { id: "tesa", group: "ghs", bases: ["TESAMORELIN"] },
  { id: "ghrp2", group: "ghs", bases: ["GHRP2"], name: "GHRP-2", molecule: "GHRP · GHRP-2", wholesaleMolecule: "GHRP" },
  { id: "ghrp6", group: "ghs", bases: ["GHRP6"], name: "GHRP-6", molecule: "GHRP · GHRP-6", wholesaleMolecule: "GHRP" },
  { id: "hexarelin", group: "ghs", bases: ["HEXARELIN"], name: "Hexarelin", molecule: "GHRP · Hexarelin", wholesaleMolecule: "GHRP" },
  // Growth factors
  { id: "igf1lr3", group: "growth", bases: ["IGF1LR3"], name: "IGF-1 LR3", molecule: "Growth factor analog · IGF-1 LR3", wholesaleMolecule: "IGF-1 analog" },
  { id: "mgf", group: "growth", bases: ["MGF"], name: "MGF", molecule: "Growth factor peptide · MGF", wholesaleMolecule: "Mechano growth factor" },
  { id: "pegmgf", group: "growth", bases: ["PEGMGF"], name: "PEG-MGF", molecule: "Growth factor peptide · PEG-MGF", wholesaleMolecule: "Pegylated MGF" },
  { id: "follistatin", group: "growth", bases: ["FOLLISTATIN"], name: "Follistatin", molecule: "Glycoprotein · Follistatin", wholesaleMolecule: "Glycoprotein" },
  // Metabolic & mitochondrial
  { id: "aod9604", group: "metabolic", bases: ["AOD9604"], name: "AOD-9604", molecule: "hGH fragment · AOD-9604", wholesaleMolecule: "hGH fragment" },
  { id: "motsc", group: "metabolic", bases: ["MOTSC"], name: "MOTS-c", molecule: "Mitochondrial-derived peptide · MOTS-c", wholesaleMolecule: "Mitochondrial-derived peptide" },
  { id: "humanin", group: "metabolic", bases: ["HUMANIN"], name: "Humanin", molecule: "Mitochondrial-derived peptide · Humanin", wholesaleMolecule: "Mitochondrial-derived peptide" },
  { id: "ss31", group: "metabolic", bases: ["SS31"], name: "SS-31", molecule: "Mitochondria-targeted peptide · SS-31", wholesaleMolecule: "Mitochondria-targeted peptide" },
  { id: "aminomq", group: "metabolic", bases: ["5AMINO1MQ"], name: "5-Amino-1MQ", molecule: "Small molecule · 5-Amino-1MQ", wholesaleMolecule: "Small molecule" },
  { id: "slupp332", group: "metabolic", bases: ["SLU-PP-332"], name: "SLU-PP-332", molecule: "Small molecule · SLU-PP-332", wholesaleMolecule: "Small molecule" },
  { id: "nad", group: "metabolic", bases: ["NAD+"], name: "NAD+", molecule: "Coenzyme · NAD+", wholesaleMolecule: "Coenzyme" },
  // Neuropeptides
  { id: "semax", group: "neuro", bases: ["SEMAX"], name: "Semax", molecule: "Neuropeptide · Semax", wholesaleMolecule: "Neuropeptide" },
  { id: "selank", group: "neuro", bases: ["SELANK"], name: "Selank", molecule: "Neuropeptide · Selank", wholesaleMolecule: "Neuropeptide" },
  { id: "dsip", group: "neuro", bases: ["DSIP"], name: "DSIP", molecule: "Neuropeptide · DSIP", wholesaleMolecule: "Neuropeptide" },
  { id: "pinealon", group: "neuro", bases: ["PINEALON"], name: "Pinealon", molecule: "Tripeptide · Pinealon", wholesaleMolecule: "Tripeptide" },
  { id: "cerebrolysin", group: "neuro", bases: ["CEREBROLYSIN"], name: "Cerebrolysin", molecule: "Peptide preparation · Cerebrolysin", wholesaleMolecule: "Peptide preparation" },
  // Bioregulators & immune
  { id: "epithalon", group: "bioregulator", bases: ["EPITHALON"], name: "Epithalon", molecule: "Tetrapeptide · Epithalon", wholesaleMolecule: "Tetrapeptide" },
  { id: "thymalin", group: "bioregulator", bases: ["THYMALIN"], name: "Thymalin", molecule: "Thymic peptide · Thymalin", wholesaleMolecule: "Thymic peptide" },
  { id: "ta1", group: "bioregulator", bases: ["THYMOSINALPHA1"], name: "Thymosin Alpha-1", molecule: "Thymic peptide · Thymosin α1", wholesaleMolecule: "Thymic peptide" },
  { id: "ll37", group: "bioregulator", bases: ["LL37"], name: "LL-37", molecule: "Antimicrobial peptide · LL-37", wholesaleMolecule: "Antimicrobial peptide" },
  { id: "vip", group: "bioregulator", bases: ["VIP"], name: "VIP", molecule: "Neuropeptide · VIP", wholesaleMolecule: "Vasoactive intestinal peptide" },
  { id: "foxo4", group: "bioregulator", bases: ["FOX-04"], name: "FOXO4-DRI", molecule: "Research peptide · FOXO4-DRI", wholesaleMolecule: "Research peptide" },
  { id: "prostamax", group: "bioregulator", bases: ["PROSTAMAX"], name: "Prostamax", molecule: "Bioregulator peptide · Prostamax", wholesaleMolecule: "Bioregulator peptide" },
  // Reproductive & melanocortin
  { id: "pt141", group: "hormone", bases: ["PT141"], name: "PT-141", molecule: "Melanocortin peptide · PT-141", wholesaleMolecule: "Melanocortin peptide" },
  { id: "mt1", group: "hormone", bases: ["MELANOTAN1"], name: "Melanotan I", molecule: "Melanocortin peptide · Melanotan I", wholesaleMolecule: "Melanocortin peptide" },
  { id: "mt2", group: "hormone", bases: ["MT2(MELANOTAN2ACETATE)"], name: "Melanotan II", molecule: "Melanocortin peptide · Melanotan II acetate", wholesaleMolecule: "Melanocortin peptide" },
  { id: "kisspeptin", group: "hormone", bases: ["KISSPEPTIN"], name: "Kisspeptin", molecule: "Neuropeptide · Kisspeptin", wholesaleMolecule: "Neuropeptide" },
  { id: "gonadorelin", group: "hormone", bases: ["GONADORELIN"], name: "Gonadorelin", molecule: "GnRH analog · Gonadorelin", wholesaleMolecule: "GnRH analog" },
  { id: "oxytocin", group: "hormone", bases: ["OXYTOCIN"], name: "Oxytocin", molecule: "Neuropeptide · Oxytocin", wholesaleMolecule: "Neuropeptide" },
  // Cosmetic
  { id: "snap8", group: "cosmetic", bases: ["SNAP8"], name: "SNAP-8", molecule: "Cosmetic peptide · SNAP-8", wholesaleMolecule: "Cosmetic peptide" },
  // Blends
  { id: "glow", group: "blends", bases: ["BLND-GLOW-BPC157GHKCUTB500", "BLND-GLOW+BPC157GHKCUTB500"], plus: { "BLND-GLOW+BPC157GHKCUTB500": "GLOW+" } },
  { id: "klow", group: "blends", bases: ["BLND-KLOW-BPC157GHKCUKPVTB500", "BLND-KLOW+BPC157GHKCUKPVTB500"], plus: { "BLND-KLOW+BPC157GHKCUKPVTB500": "KLOW+" }, name: "KLOW Stack", molecule: "Regen blend · BPC-157 + GHK-Cu + KPV + TB-500", wholesaleMolecule: "BPC-157 + GHK-Cu + KPV + TB-500" },
  { id: "wolv", group: "blends", bases: ["BLND-WOLVERINE-BPC157TB500"] },
  { id: "cjcipa", group: "blends", bases: ["BLND-CJC1295IPAMORELIN"] },
  { id: "aodcjcipa", group: "blends", bases: ["BLND-AOD9604CJC1295IPAMORELIN"], name: "AOD-9604 / CJC-1295 / Ipamorelin", molecule: "Blend · AOD-9604 + CJC-1295 + Ipamorelin", wholesaleMolecule: "AOD-9604 + CJC-1295 + Ipamorelin" },
  { id: "tesaipa", group: "blends", bases: ["BLND-TESAMORELINIPAMORELIN"], name: "Tesamorelin / Ipamorelin", molecule: "Secretagogue blend · Tesamorelin + Ipamorelin", wholesaleMolecule: "Tesamorelin + Ipamorelin" },
  { id: "ipaser", group: "blends", bases: ["BLND-IPAMORELINSERMORELIN"], name: "Ipamorelin / Sermorelin", molecule: "Secretagogue blend · Ipamorelin + Sermorelin", wholesaleMolecule: "Ipamorelin + Sermorelin" },
  { id: "teamo", group: "blends", bases: ["BLND-TEAMOTESAMORELINMOTSCAOD9604"], name: "TEAMO Blend", molecule: "Blend · Tesamorelin + MOTS-c + AOD-9604", wholesaleMolecule: "Tesamorelin + MOTS-c + AOD-9604" },
  { id: "selanksemax", group: "blends", bases: ["BLND-SELANKSEMAX"], name: "Selank / Semax", molecule: "Neuropeptide blend · Selank + Semax", wholesaleMolecule: "Selank + Semax" },
  { id: "dsipselank", group: "blends", bases: ["BLND-DSIPSELANK"], name: "DSIP / Selank", molecule: "Neuropeptide blend · DSIP + Selank", wholesaleMolecule: "DSIP + Selank" },
  { id: "ta1thymulin", group: "blends", bases: ["BLND-THYMOSINALPHA1THYMULIN"], name: "Thymosin Alpha-1 / Thymulin", molecule: "Thymic blend · Thymosin α1 + Thymulin", wholesaleMolecule: "Thymosin α1 + Thymulin" },
  { id: "ta1thymulinkpv", group: "blends", bases: ["BLND-THYMOSINALPHA1THYMULINKPV"], name: "Thymosin Alpha-1 / Thymulin / KPV", molecule: "Thymic blend · Thymosin α1 + Thymulin + KPV", wholesaleMolecule: "Thymosin α1 + Thymulin + KPV" },
  { id: "pt141kisspin", group: "blends", bases: ["BLND-PT141KISSPEPTINPINEALON"], name: "PT-141 / Kisspeptin / Pinealon", molecule: "Blend · PT-141 + Kisspeptin + Pinealon", wholesaleMolecule: "PT-141 + Kisspeptin + Pinealon" },
  { id: "pt141oxykiss", group: "blends", bases: ["BLND-PT141OXYTOCINKISSPEPTIN"], name: "PT-141 / Oxytocin / Kisspeptin", molecule: "Blend · PT-141 + Oxytocin + Kisspeptin", wholesaleMolecule: "PT-141 + Oxytocin + Kisspeptin" },
  // Supplies
  { id: "bacwater", group: "supplies", bases: ["BACWATER"], name: "Bacteriostatic Water", molecule: "Reconstitution supply · Bacteriostatic water", wholesaleMolecule: "Reconstitution supply", format: "Sterile liquid" },
];

// "05" → 5, "2.5" → 2.5, ".01" → 0.1 (the sheet zero-pads; .01 is the 0.1 mg vial).
const dose = (text) => (text.startsWith(".0") ? Number(`0.${text.slice(2)}`) : Number(text));

function parseSku(sku) {
  if (sku === "BACWATER-30ML") return { base: "BACWATER", parts: null, ml: 30 };
  const match = sku.match(/^(.*?)-(\.?\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?)*)(?:MG)?-0?(\d+)ML$/);
  if (!match) throw new Error(`Unrecognised SKU ${sku}`);
  return { base: match[1], parts: match[2].split("X").map(dose), ml: Number(match[3]) };
}

// Existing metadata (photo, purity, lot, descriptions) is kept from the current files.
const current = new Function(`${fs.readFileSync(path.join(root, "assets/catalog.js"), "utf8")}; return PRODUCTS;`)();
const wholesaleFile = path.join(root, "wholesale.html");
const wholesaleHtml = fs.readFileSync(wholesaleFile, "utf8");
const blockStart = wholesaleHtml.indexOf("  var PRODUCTS = [");
const blockEnd = wholesaleHtml.indexOf("\n  ];", blockStart) + "\n  ];".length;
const currentWholesale = new Function(`${wholesaleHtml.slice(blockStart, blockEnd)}; return PRODUCTS;`)();
const byId = (list) => new Map(list.map((p) => [p.id, p]));
const retailMeta = byId(current), wholesaleMeta = byId(currentWholesale);

const used = new Set();
const groupCodes = Object.fromEntries(Object.keys(GROUPS).map((key, i) => [key, String.fromCharCode(65 + i)]));

const variantsFor = (product) =>
  Object.keys(sheet)
    .map((sku) => ({ sku, ...parseSku(sku) }))
    .filter(({ base }) => product.bases.includes(base))
    .map(({ sku, base, parts, ml }) => {
      used.add(sku);
      const tiers = [1, 10, 25].map((q) => ({ q, p: sheet[sku][q] }));
      if (!parts) return { label: `${ml} mL`, mgLabel: "Water", ml, tiers };
      if (parts.length === 1) return { mg: parts[0], ml, tiers };
      const mgLabel = `${parts.join(" + ")} mg`;
      const prefix = product.plus?.[base] ? `${product.plus[base]} · ` : "";
      return { label: `${prefix}${mgLabel} · ${ml} mL`, mgLabel, ml, tiers };
    });

const retail = [], wholesale = [];
for (const product of PRODUCTS) {
  const group = GROUPS[product.group];
  const old = retailMeta.get(product.id) || {};
  const oldW = wholesaleMeta.get(product.id) || {};
  // Keep an existing product's option order (its first option is the default).
  const key = (v) => `${String(v.mgLabel || v.mg).replace(/\s/g, "")}-${v.ml}`;
  const order = (old.variants || []).map(key);
  const rank = (v) => (order.includes(key(v)) ? order.indexOf(key(v)) : order.length);
  const variants = variantsFor(product).sort((a, b) => rank(a) - rank(b));
  if (!variants.length) throw new Error(`No SKUs for ${product.id}`);
  const shape = ({ tiers, ...v }, priceField) => ({ ...v, ...priceField(tiers) });
  retail.push({
    id: product.id,
    cat: group.cat,
    catCode: groupCodes[product.group],
    catFilter: group.filter,
    name: old.name || product.name,
    molecule: old.molecule || product.molecule,
    ...(old.purity && { purity: old.purity, lot: old.lot }),
    ...(product.format && { format: product.format }),
    img: old.img || PLACEHOLDER,
    ...((old.img || PLACEHOLDER) === PLACEHOLDER && { placeholder: true }),
    variants: variants.map((v) => shape(v, (tiers) => ({ price: tiers[0].p }))),
  });
  wholesale.push({
    id: product.id,
    cat: group.wholesale,
    catCode: groupCodes[product.group],
    name: oldW.name || old.name || product.name,
    molecule: oldW.molecule || product.wholesaleMolecule,
    ...(oldW.purity && { purity: oldW.purity, lot: oldW.lot }),
    img: oldW.img || PLACEHOLDER,
    variants: variants.map((v) => shape(v, (tiers) => ({ tiers }))),
  });
}
const unused = Object.keys(sheet).filter((sku) => !used.has(sku));
if (unused.length) throw new Error(`SKUs not mapped to a product: ${unused.join(", ")}`);

// ─── Write ───
const js = (value) => JSON.stringify(value).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:");
const groupComment = (list, i, key) => (i === 0 || list[i - 1].catCode !== list[i].catCode ? `\n  // ─── ${list[i][key]} ───\n` : "");

const retailBody = retail
  .map((p, i) => {
    const { variants, ...fields } = p;
    const head = Object.entries(fields).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`).join("\n");
    return `${groupComment(retail, i, "cat")}  {\n${head}\n    variants: [\n${variants.map((v) => `      ${js(v)},`).join("\n")}\n    ],\n  },`;
  })
  .join("\n");
fs.writeFileSync(
  path.join(root, "assets/catalog.js"),
  `// Hello You Labs catalog, generated by scripts/build_catalog.cjs from the price
// sheet. Retail prices are the single-vial (qty 1) prices. Edit the script's
// product list or the sheet and rebuild rather than editing this file.
const PRODUCTS = [${retailBody}
];
if (typeof module !== "undefined") module.exports = { PRODUCTS };
`,
);

const wholesaleBody = wholesale
  .map((p, i) => {
    const { variants, ...fields } = p;
    const head = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v).replace(/"/g, "'")}`).join(", ");
    return `${groupComment(wholesale, i, "cat").replace(/\n  /g, "\n    ")}    {\n      ${head},\n      variants: [\n${variants.map((v) => `        ${js(v).replace(/"/g, "'")}`).join(",\n")}\n      ]\n    }`;
  })
  .join(",\n");
fs.writeFileSync(
  wholesaleFile,
  wholesaleHtml.slice(0, blockStart) +
    `  var PRODUCTS = [ // Generated by scripts/build_catalog.cjs from the price sheet (1 / 10 / 25 vial tiers).${wholesaleBody}\n  ];` +
    wholesaleHtml.slice(blockEnd),
);

const added = retail.filter((p) => p.placeholder).length;
console.log(`${retail.length} products (${added} new), ${retail.reduce((n, p) => n + p.variants.length, 0)} variants, ${Object.keys(sheet).length} SKUs`);
for (const [sku, t] of Object.entries(sheet)) if (t[10] > t[1] || t[25] > t[10]) console.log(`Check sheet: ${sku} volume price goes up (${t[1]} / ${t[10]} / ${t[25]})`);

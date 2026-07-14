import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COUNTRIES, TOURNAMENT_COUNTRIES, TOURNAMENT_LOCATIONS } from "../app/data-options.ts";

test("country and tournament location catalogs match the editor specification", () => {
  assert.equal(COUNTRIES.length, 194);
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  assert.ok(COUNTRIES.includes("Cote D'Ivoire"));
  assert.ok(COUNTRIES.includes("Micronesia Federated"));
  assert.equal(TOURNAMENT_LOCATIONS.length, 56);
  assert.deepEqual(TOURNAMENT_LOCATIONS[0], { city: "Katowice", country: "Poland" });
  assert.deepEqual(TOURNAMENT_LOCATIONS.at(-1), { city: "Auckland", country: "New Zealand" });
  assert.ok(TOURNAMENT_COUNTRIES.includes("UAE"));
  assert.deepEqual(TOURNAMENT_LOCATIONS.filter(({ country }) => country === "Germany").map(({ city }) => city), ["Cologne", "Berlin"]);
});

test("editor includes relation selectors, cloning and per-table asset guidance", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /Country: \{ options: \[\.\.\.COUNTRIES\] \}/);
  assert.match(source, /Team: \{ ref: "Teams", refField: "Nick" \}/);
  assert.match(source, /function cloneRow\(\)/);
  assert.match(source, /disabled=\{tournamentCity && !selected\?\.Country\}/);
  assert.match(source, /地区与所选国家不匹配/);
  assert.doesNotMatch(source, /updateCell\("Country", location\.country\)/);
  assert.match(source, /onBlur=\{\(event\) => \{/);
  assert.match(source, /aria-autocomplete=\{suggestions\.length \? "list"/);
  assert.match(source, /输入关键字搜索或选择/);
  assert.match(source, /function NetworkImagePreview/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /className="language-button"/);
  assert.match(source, /Switch to Chinese/);
  assert.match(source, /复制为新记录/);
  assert.ok(source.includes('`${root}\\\\Players`'));
  assert.ok(source.includes('`${root}\\\\Teams`'));
  assert.ok(source.includes('`${root}\\\\Staffs`'));
  assert.ok(source.includes('`${root}\\\\Sponsors`'));
  assert.ok(source.includes('`${root}\\\\Tournaments`'));
  assert.match(source, /400×417 px/);
  assert.match(source, /1024×1024 px/);
});

test("launcher distinguishes EMDB editor from an unrelated service", async () => {
  const launcher = await readFile(new URL("../../Start_EMDB_Editor.js", import.meta.url), "utf8");
  assert.match(launcher, /body\.includes\("EMDB Local Editer"\)/);
  assert.match(launcher, /serverStatus === "occupied"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/character-data/CharacterDataUtility.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the internal static CharacterDataUtility
// functions (appendData/deleteData/insertData/replaceData/substringData) are
// the implementations of the public CharacterData methods of the same name, so
// every assertion migrates to the public CharacterData member (`node.data` is
// read after each mutation). The utility class itself has no public export and
// is not constructed here.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-character-data-utility";
export const description = "real differential: public CharacterData appendData/deleteData/insertData/replaceData/substringData and the data readback";
export const targets = "real";

export async function run(api) {
  const entry = api.dom;

  let window;
  try {
    window = new entry.Window();
  } catch (error) {
    api.record.error(error, "setup");
    return;
  }
  const document = window.document;

  try {
    const append = document.createComment("test");
    append.appendData("appended");
    api.record.value("append-data", append.data);

    const del = document.createComment("longstring");
    del.deleteData(1, 3);
    api.record.value("delete-data", del.data);

    const insert = document.createComment("longstring");
    insert.insertData(1, "test");
    api.record.value("insert-data", insert.data);

    const replace = document.createComment("longstring");
    replace.replaceData(1, 3, "test");
    api.record.value("replace-data", replace.data);

    const substring = document.createComment("longstring");
    api.record.value("substring-data", substring.substringData(1, 3));
  } catch (error) {
    api.record.error(error, "facade");
  }
}

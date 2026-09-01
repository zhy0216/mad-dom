// ─────────────────────────────────────────────────────────────────────────────
// DIFFERENTIAL SCENARIO — hand-ported from the happy-dom (MIT) test suite
// Upstream repository: https://github.com/capricorn86/happy-dom
// Upstream commit:    64e2c774cadbb8eda5416c1e2bcca5006d1b5df9
// Upstream tag:       v20.11.11
// Upstream path:      packages/happy-dom/test/nodes/html-table-cell-element/HTMLTableCellElement.test.ts
// Source:             hand-ported to public API (plans/0002 §4)
//
// Hand-ported to public API: the public HTMLTableCellElement surface — the
// abbr/headers/scope string reflections, the colSpan/rowSpan unsigned-long
// reflections (default and clamp to 1) and the cellIndex read on td/th inside
// a <tr>.
//
// License: MIT — https://github.com/capricorn86/happy-dom/blob/64e2c774cadbb8eda5416c1e2bcca5006d1b5df9/LICENSE
// ─────────────────────────────────────────────────────────────────────────────
export const id = "nodes-html-table-cell-element";
export const description = "real differential: public HTMLTableCellElement abbr/colSpan/headers/rowSpan/scope/cellIndex";
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
    const element = document.createElement("td");
    const th = document.createElement("th");
    api.record.value("toString-tag", Object.prototype.toString.call(element));

    // abbr / headers / scope string reflections.
    for (const property of ["abbr", "headers", "scope"]) {
      api.record.value(`get-${property}-default`, element[property]);
      element.setAttribute(property, "test");
      api.record.value(`get-${property}`, element[property]);
      element[property] = "test";
      api.record.value(`set-${property}`, element.getAttribute(property));
    }

    // cellIndex.
    api.record.value("cellIndex-default", element.cellIndex);
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    tr.appendChild(td1);
    tr.appendChild(td2);
    api.record.value("cellIndex-td1", td1.cellIndex);
    api.record.value("cellIndex-td2", td2.cellIndex);

    // colSpan.
    api.record.value("colSpan-default", element.colSpan);
    element.setAttribute("colspan", "2");
    api.record.value("colSpan-attr", element.colSpan);
    element.setAttribute("colspan", "test");
    api.record.value("colSpan-invalid", element.colSpan);
    element.setAttribute("colspan", "0");
    api.record.value("colSpan-zero", element.colSpan);
    element.colSpan = 2;
    api.record.value("colSpan-set", element.getAttribute("colspan"));
    element.colSpan = "test";
    api.record.value("colSpan-set-invalid", element.getAttribute("colspan"));
    element.colSpan = 0;
    api.record.value("colSpan-set-zero", element.getAttribute("colspan"));

    // rowSpan.
    api.record.value("rowSpan-default", element.rowSpan);
    element.setAttribute("rowspan", "2");
    api.record.value("rowSpan-attr", element.rowSpan);
    element.setAttribute("rowspan", "test");
    api.record.value("rowSpan-invalid", element.rowSpan);
    element.setAttribute("rowspan", "0");
    api.record.value("rowSpan-zero", element.rowSpan);
    element.rowSpan = 2;
    api.record.value("rowSpan-set", element.getAttribute("rowspan"));
    element.rowSpan = "test";
    api.record.value("rowSpan-set-invalid", element.getAttribute("rowspan"));
    element.rowSpan = 0;
    api.record.value("rowSpan-set-zero", element.getAttribute("rowspan"));
  } catch (error) {
    api.record.error(error, "facade");
  }
}

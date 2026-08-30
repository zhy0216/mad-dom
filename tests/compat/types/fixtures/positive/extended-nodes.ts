// Positive fixture: the T33 extended-node surface. Document creation helpers
// (createComment / createProcessingInstruction), the CharacterData data /
// length / substring / append / insert / delete / replace surface on Text and
// Comment, Text.splitText, Node.nodeValue / cloneNode, Document.importNode /
// adoptNode / doctype, ProcessingInstruction.target and the DocumentType
// payload reads.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
// Instances are typed through function parameters because MAD DOM only mints
// windows through createWindow() — its Window is not constructible.
import { Comment, Document, DocumentType, Node, ProcessingInstruction, Text } from "dom-under-test";

function useExtendedNodeSurface(
  document: Document,
  text: Text,
  comment: Comment,
  pi: ProcessingInstruction,
  dt: DocumentType,
): void {
  // CharacterData surface on Text.
  const data: string = text.data;
  text.data = "hello";
  const length: number = text.length;
  const substring: string = text.substringData(0, 2);
  text.appendData("!");
  text.insertData(0, "x");
  text.deleteData(0, 1);
  text.replaceData(0, 1, "y");
  const tail: Text = text.splitText(2);

  // nodeValue and the clone family.
  const value: string | null = text.nodeValue;
  text.nodeValue = "z";
  const copy: Node = text.cloneNode(true);
  const imported: Node = document.importNode(copy, true);
  const adopted: Node = document.adoptNode(copy);

  // CharacterData surface on Comment.
  comment.data = "c";
  const commentSubstring: string = comment.substringData(0, 1);

  // ProcessingInstruction: target plus the CharacterData data.
  const target: string = pi.target;
  pi.data = "d";

  // DocumentType payload reads.
  const name: string = dt.name;
  const publicId: string = dt.publicId;
  const systemId: string = dt.systemId;
  const doctype: DocumentType | null = document.doctype;

  // Node creation helpers.
  const made: ProcessingInstruction = document.createProcessingInstruction(
    "xml-stylesheet",
    "href=x",
  );
  const madeComment: Comment = document.createComment("note");

  const result = {
    data,
    length,
    substring,
    tail,
    value,
    copy,
    imported,
    adopted,
    commentSubstring,
    target,
    name,
    publicId,
    systemId,
    doctype,
    made,
    madeComment,
  };
  void result;
}

export const exported = { useExtendedNodeSurface };

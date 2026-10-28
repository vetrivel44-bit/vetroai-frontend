// A markdown table cell the AI left empty ("| a |  | c |") should read as
// "no value", not as a rendering glitch. `children` is what react-markdown
// hands a <td>: undefined, a string, an element, or an array of those.
export function isBlankCell(children) {
  if (children == null || children === false) return true;
  if (typeof children === "string") return children.trim() === "";
  if (Array.isArray(children)) return children.every(isBlankCell);
  return false;
}

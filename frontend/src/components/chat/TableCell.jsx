import React from "react";
import { isBlankCell } from "../../lib/tableCells";

// Markdown <td> that shows a muted "—" when the AI left the cell empty.
export function TableCell({ node, children, ...rest }) {
  if (isBlankCell(children)) {
    return <td {...rest}><span style={{ color: "var(--ink-3)" }} title="No value given">—</span></td>;
  }
  return <td {...rest}>{children}</td>;
}

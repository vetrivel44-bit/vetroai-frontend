import React, { useMemo } from "react";
import { Chessboard } from "react-chessboard";
import "./board2d.css";

// A flat, top-down board — the kind chess.com and Lichess use — with the
// classic Staunton piece set. Every square and piece stays readable on a
// phone, which the 3D table view could not manage.
//
// Same props as Board3D, plus `onMove(from, to)` for drag-and-drop (returns
// whether the move was played). Tapping a piece and then a square goes
// through `onSquareClick`, exactly as before.

const LIGHT = "#F0D9B5";
const DARK = "#B58863";

const overlay = (color) => ({ backgroundImage: `linear-gradient(${color}, ${color})` });

function findKingSquare(chess, color) {
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.type === "k" && cell.color === color) return cell.square;
    }
  }
  return null;
}

export default function Board2D({
  chess,
  orientation = "w",
  lastMove = null,
  selected = null,
  legalTargets = [],
  onSquareClick,
  onMove,
  interactive = false,
  inCheck = false,
  draggableColor = null,
}) {
  const fen = chess.fen();

  const squareStyles = useMemo(() => {
    const styles = {};
    const add = (square, style) => { styles[square] = { ...(styles[square] || {}), ...style }; };
    if (lastMove) {
      add(lastMove.from, overlay("rgba(246, 214, 72, 0.5)"));
      add(lastMove.to, overlay("rgba(246, 214, 72, 0.5)"));
    }
    if (selected) add(selected, overlay("rgba(20, 110, 60, 0.45)"));
    for (const square of legalTargets) {
      const capture = Boolean(chess.get(square));
      add(square, {
        backgroundImage: capture
          ? "radial-gradient(circle, transparent 56%, rgba(20, 30, 20, 0.28) 58%, rgba(20, 30, 20, 0.28) 72%, transparent 74%)"
          : "radial-gradient(circle, rgba(20, 30, 20, 0.28) 20%, transparent 22%)",
        cursor: "pointer",
      });
    }
    if (inCheck) {
      const king = findKingSquare(chess, chess.turn());
      if (king) add(king, { backgroundImage: "radial-gradient(circle, rgba(255, 40, 40, 0.95) 0%, rgba(230, 20, 20, 0.55) 35%, rgba(200, 0, 0, 0) 72%)" });
    }
    return styles;
    // `fen` stands in for the mutable chess instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, lastMove, selected, legalTargets, inCheck]);

  const options = {
    id: "vetro-arena-board",
    position: fen,
    boardOrientation: orientation === "b" ? "black" : "white",
    lightSquareStyle: { backgroundColor: LIGHT },
    darkSquareStyle: { backgroundColor: DARK },
    lightSquareNotationStyle: { color: DARK, fontWeight: 700 },
    darkSquareNotationStyle: { color: LIGHT, fontWeight: 700 },
    squareStyles,
    dropSquareStyle: { boxShadow: "inset 0 0 0 4px rgba(20, 110, 60, 0.6)" },
    animationDurationInMs: 220,
    allowDragging: Boolean(interactive && onMove),
    allowDrawingArrows: false,
    canDragPiece: ({ piece }) => Boolean(interactive && draggableColor && piece?.pieceType?.[0] === draggableColor),
    onPieceDrop: ({ sourceSquare, targetSquare }) => (interactive && onMove && targetSquare ? onMove(sourceSquare, targetSquare) : false),
    onSquareClick: ({ square }) => { if (interactive) onSquareClick?.(square); },
  };

  return (
    <div className="ca-board2d">
      <Chessboard options={options} />
    </div>
  );
}

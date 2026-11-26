import { roomSigil } from '../engine/safety';

interface RoomSigilProps {
  roomId: string;
}

export function RoomSigil({ roomId }: RoomSigilProps) {
  const { shape, color } = roomSigil(roomId);

  if (shape === 'diamond') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        className="shrink-0"
        aria-hidden="true"
      >
        <polygon points="6,1 11,6 6,11 1,6" fill={color} />
      </svg>
    );
  }

  if (shape === 'hex') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        className="shrink-0"
        aria-hidden="true"
      >
        <polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill={color} />
      </svg>
    );
  }

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className="shrink-0"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill={color} />
    </svg>
  );
}

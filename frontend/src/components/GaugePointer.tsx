import { useGaugeState } from "@mui/x-charts/Gauge";

export default function GaugePointer() {
  
  return null;
  /** 
  const { valueAngle, outerRadius, cx, cy } = useGaugeState();

  if (valueAngle === null) {
    return null;
  }

  const target = {
    x: cx + outerRadius * Math.sin(valueAngle),
    y: cy - outerRadius * Math.cos(valueAngle),
  };

  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#c41e3a" />
      <path
        d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
        stroke="#c41e3a"
        strokeWidth={3}
      />
    </g>
  );

  */
}

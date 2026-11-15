import type { SVGProps } from "react";

const S = (p: SVGProps<SVGSVGElement>) => <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" {...p} />;
export const Ic = {
  grid: () => <S><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></S>,
  bars: () => <S><path d="M2 13.5h12M4 11V7M8 11V3.5M12 11V8.5" /></S>,
  funnel: () => <S><path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5z" /></S>,
  sliders: () => <S><path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" /><circle cx="10.5" cy="4.5" r="1.5" /><circle cx="5.5" cy="11.5" r="1.5" /></S>,
  doc: () => <S><path d="M4 1.8h5.5L12.5 5v9.2H4z" /><path d="M9.5 1.8V5h3M6 8h4.5M6 10.8h4.5" /></S>,
  shield: () => <S><path d="M8 1.8l5 2v4.1c0 3-2.1 5.3-5 6.3-2.9-1-5-3.3-5-6.3V3.8z" /><path d="M5.8 8l1.6 1.6L10.4 6.6" /></S>,
  gear: () => <S><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2" /></S>,
  menu: () => <S><path d="M2 4h12M2 8h8M2 12h10" /></S>,
  more: () => <S><circle cx="3.5" cy="8" r=".6" /><circle cx="8" cy="8" r=".6" /><circle cx="12.5" cy="8" r=".6" /></S>,
  table: () => <S><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 6.2h12M2 9.8h12M6 6.2v7.3" /></S>,
  close: () => <S><path d="M4 4l8 8M12 4l-8 8" /></S>,
  chev: () => <S style={{ width: 12, color: "var(--muted)" }}><path d="M4.5 6.5L8 10l3.5-3.5" /></S>,
  prev: () => <S><path d="M10 3.5L5.5 8l4.5 4.5" /></S>,
  next: () => <S><path d="M6 3.5L10.5 8 6 12.5" /></S>,
  play: () => <S><path d="M5 3.5v9l7-4.5z" /></S>,
  pause: () => <S><path d="M5.5 3.5v9M10.5 3.5v9" /></S>,
  reset: () => <S><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.5h2.5" /></S>,
  lock: () => <S style={{ width: 12, height: 12 }}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></S>,
  code: () => <S style={{ width: 13, height: 13 }}><path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" /></S>,
  undo: () => <S style={{ width: 13, height: 13 }}><path d="M5 3.5L2.5 6 5 8.5" /><path d="M2.5 6h7a3.5 3.5 0 0 1 0 7H7" /></S>,
};
export const Car = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const Spark = ({ size = 10 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .6l1.1 3.3L9.4 5 6.1 6.1 5 9.4 3.9 6.1.6 5l3.3-1.1z" fill="currentColor" /></svg>;
export const Check = () => <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const User = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="4.2" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M1.8 11c.6-2.2 2.2-3.2 4.2-3.2s3.6 1 4.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
export const Run = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2a4.8 4.8 0 1 1-4.8 4.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
export const Blocked = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2.8 9.2l6.4-6.4" stroke="currentColor" strokeWidth="1.4" /></svg>;

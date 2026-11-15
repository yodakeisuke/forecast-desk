import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from "@ui-sdk/react/slider";
import { Button } from "@ui-sdk/react/button";
import { actions, useApp } from "../state/store";
import { broadcastState } from "../genui/host";
import { Card } from "./Card";
import { useCube, useWidth } from "../state/useCube";
import { scenarioPL } from "../data/cube";
import { scenarioChart } from "../shared/charts";
import { SvgChart } from "./SvgChart";
const fields = [{path:"/scenario/slipBack",label:"スリップ案件の戻り率",min:0,max:100},{path:"/scenario/winRate",label:"成約率",min:0,max:100},{path:"/scenario/naBias",label:"見通し補正",min:-30,max:30}];
export function ScenarioControls() {
 const scenario=useApp(s=>s.scenario), filters=useApp(s=>s.filters);
 const d=useCube(`scenario|${JSON.stringify([scenario.values,filters])}`,()=>scenarioPL({slipBack:scenario.values["/scenario/slipBack"],winRate:scenario.values["/scenario/winRate"],naBias:scenario.values["/scenario/naBias"],filters}));
 const [ref,w]=useWidth<HTMLDivElement>();
 return <Card id="c-scenario" cls="c12" title="シナリオ前提" sub={`${Object.values(filters).filter(Boolean).join(" / ") || "全社"} · 実績と確定版は変更せず、前提による営業利益を試算`}>
 <div className="card-b"><div className="scenario-controls">{fields.map(f=><div key={f.path} className="scenario-control">
 <label>{f.label} <b>{scenario.values[f.path]}%</b></label>
 <Slider value={scenario.values[f.path]} min={f.min} max={f.max} step={1} onValueChange={(value,details)=>{actions.setScenario(f.path,Number(value),details.source==="agent"?"agent":"user");broadcastState(f.path);}}>
 <SliderControl className="scenario-slider"><SliderTrack className="scenario-track"><SliderIndicator className="scenario-indicator"/><SliderThumb className="scenario-thumb" aria-label={`${f.label}（ホスト）`}/></SliderTrack></SliderControl></Slider>
 </div>)}</div><div ref={ref}>{d&&w>0&&<SvgChart chart={scenarioChart({cases:d.cases,refs:d.refs,w})}/>}</div>
 <Button className="tbtn" onClick={()=>actions.undoScenario("widget").forEach(broadcastState)}>生成UIの変更だけ戻す</Button>
 </div></Card>;
}

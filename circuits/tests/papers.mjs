// Run with `node tests/papers.mjs` from circuits/. Opens every past-paper circuit and checks
// the readings against the answers the papers expect.
import { PAPERS } from "../js/papers.js";
import { Sim } from "../js/sim.js";
import { resistanceOf } from "../js/parts.js";

let failed = 0;
function check(name, got, want, tolerance = 0.01) {
	const ok = Math.abs(got - want) <= (want ? tolerance * Math.abs(want) : tolerance);
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got.toPrecision(4)} (want ${want.toPrecision(4)})`);
}

// Opens a paper's circuit and lets it settle; gives helpers to read it.
function open(year, q) {
	const paper = PAPERS.find((p) => p.year === year && p.q === q);
	const c = paper.build();
	const sim = new Sim();
	sim.load(c);
	sim.step(1e-3);
	const s = (part) => sim.states.get(part.id);
	const by = (type, k = 0) => c.parts.filter((p) => p.type === type)[k];
	const named = (name, k = 0) => c.parts.filter((p) => p.name === name)[k];
	const ohms = (value, k = 0) => c.parts.filter((p) => resistanceOf(p) === value)[k];
	const I = (part) => Math.abs(s(part).i);
	const Vacross = (part) => Math.abs(s(part).v);
	const P = (part) => Math.abs(s(part).v * s(part).i);
	const rerun = () => {
		sim.load(c);
		sim.step(1e-3);
	};
	return { c, sim, by, named, ohms, I, V: Vacross, P, rerun, tag: `${year} ${q}` };
}

{
	const t = open(2012, "Q1");
	check(`${t.tag} supply current, 12 V ÷ 6.26 Ω`, t.I(t.by("battery")), 12 / ((28.8 * 8) / 36.8));
	check(`${t.tag} the 18 W lamp makes 18 W`, t.P(t.named("12 V 18 W")), 18);
}
{
	const t = open(2012, "Q2");
	check(`${t.tag} series current, 12 V ÷ 86.4 Ω`, t.I(t.by("battery")), 12 / 86.4);
}
{
	const t = open(2012, "Q2(b)");
	check(`${t.tag} current drawn, 12 V ÷ 43.2 Ω`, t.I(t.by("battery")), 12 / 43.2);
	check(`${t.tag} lamp A gets 8 V`, t.V(t.named("A")), 8);
}
{
	const t = open(2012, "Q4");
	check(`${t.tag} current in the rod`, t.I(t.by("resistor")), 12 / 35.4);
}
{
	const t = open(2013, "Q2(a)");
	check(`${t.tag} voltmeter reads 18.0 V`, t.V(t.by("voltmeter")), 18);
	check(`${t.tag} current in the 6.0 Ω is 3.0 A`, t.I(t.ohms(6)), 3);
}
{
	const t = open(2013, "Q2(c)");
	check(`${t.tag} 2.0 A in the 6.0 Ω`, t.I(t.ohms(6)), 2);
	check(`${t.tag} power in the 3.0 Ω is 27 W`, t.P(t.ohms(3)), 27);
}
{
	const t = open(2014, "Q2");
	check(`${t.tag} ammeter reads 6.0 A`, t.I(t.by("ammeter")), 6);
	check(`${t.tag} voltage across the 3.5 Ω`, t.V(t.ohms(3.5)), 6 * ((6.8 * 3.5) / 10.3));
	check(`${t.tag} the 2.2 Ω converts less than the 4.6 Ω`, t.P(t.ohms(2.2)) < t.P(t.ohms(4.6)) ? 1 : 0, 1);
}
{
	const t = open(2014, "Q3(a)");
	const before = t.P(t.named("A"));
	t.named("B").props.broken = true;
	t.rerun();
	check(`${t.tag} lamp A dims when lamp B blows`, t.P(t.named("A")) < before ? 1 : 0, 1);
}
{
	const a = open(2014, "Q3(a)");
	const b = open(2014, "Q3(b)");
	check(`${b.tag} adding D raises the voltage on A`, b.V(b.named("A")) > a.V(a.named("A")) ? 1 : 0, 1);
	check(`${b.tag} …and lowers it on B`, b.V(b.named("B")) < a.V(a.named("B")) ? 1 : 0, 1);
}
{
	const t = open(2014, "Q3(c)");
	check(`${t.tag} ammeter reads 6.0 A`, t.I(t.by("ammeter")), 6);
	check(`${t.tag} 3.0 V across the 0.5 Ω`, t.V(t.ohms(0.5)), 3);
}
{
	const t = open(2015, "Q1");
	check(`${t.tag} 6.0 V across 1.0 m of wire: 6.0 V/m`, t.V(t.by("voltmeter")) / 1.0, 6);
}
{
	const t = open(2015, "Q4(a)");
	check(`${t.tag} each lamp takes 0.333 A`, t.I(t.by("lamp")), 1 / 3);
	check(`${t.tag} lamps at 6.0 V`, t.V(t.by("lamp")), 6);
	const before = t.I(t.by("resistor"));
	t.by("lamp").props.broken = true;
	t.rerun();
	check(`${t.tag} one lamp blows: the resistor's current falls`, t.I(t.by("resistor")) < before ? 1 : 0, 1);
}
{
	const t = open(2015, "Q4(d)");
	check(`${t.tag} 6.0 V across the 4.0 Ω`, t.V(t.by("resistor")), 6);
}
{
	const t = open(2016, "Q1");
	check(`${t.tag} ammeter reads 0.300 A`, t.I(t.by("ammeter")), 0.3);
	check(`${t.tag} 3.00 V across the receiver`, t.V(t.named("Receiver")), 3);
	check(`${t.tag} 0.1125 A through speaker A`, t.I(t.named("Speaker A")), 0.1125);
	check(`${t.tag} speaker B uses more power`, t.P(t.named("Speaker B")) > t.P(t.named("Speaker A")) ? 1 : 0, 1);
}
{
	const t = open(2016, "Q3");
	check(`${t.tag} switch open: no current`, t.I(t.by("resistor")), 0, 1e-6);
	t.by("switch").props.closed = true;
	t.rerun();
	check(`${t.tag} switch closed: 0.600 A`, t.I(t.by("resistor")), 0.6);
}
{
	const t = open(2017, "Q2(b)");
	check(`${t.tag} each bulb at 9.00 V`, t.V(t.by("lamp")), 9, 0.005);
}
{
	const t = open(2017, "Q2(d)");
	check(`${t.tag} 2.13 A from the battery`, t.I(t.by("ammeter")), 2.13, 0.005);
	check(`${t.tag} bulb 1 now over 9 V`, t.V(t.named("Bulb 1")) > 9 ? 1 : 0, 1);
}
{
	const t = open(2017, "Q3");
	check(`${t.tag} 5.00 A to the spotlight`, t.I(t.by("ammeter")), 5);
}
{
	const t = open(2018, "Q3");
	check(`${t.tag} total resistance about 10 Ω`, 12 / t.I(t.by("battery")), 7 + (4.8 * 7) / 11.8);
	check(`${t.tag} voltage across bulb 1`, t.V(t.named("Bulb 1")), (12 * 7) / (7 + (4.8 * 7) / 11.8));
	check(`${t.tag} bulb 2 is brighter than bulb 3`, t.P(t.named("Bulb 2")) > t.P(t.named("Bulb 3")) ? 1 : 0, 1);
}
{
	const t = open(2018, "Q3(d)");
	check(`${t.tag} bulb 1 shorted out`, t.I(t.named("Bulb 1")), 0, 1e-3);
	check(`${t.tag} ammeter reads 12 V ÷ 2.85 Ω`, t.I(t.by("ammeter")), 12 / ((4.8 * 7) / 11.8));
}
{
	const t = open(2019, "Q1(a)");
	check(`${t.tag} voltmeter reads 4.0 V`, t.V(t.by("voltmeter")), 4);
	check(`${t.tag} circuit current 0.80 A`, t.I(t.by("battery")), 0.8);
	check(`${t.tag} heat from R in 2 minutes`, t.P(t.named("R")) * 120, 0.8 * 11 * 120);
}
{
	const t = open(2019, "Q1(c)");
	check(`${t.tag} total resistance 2.51 Ω`, 12 / t.I(t.by("ammeter")), (11.6 * 3.2) / 14.8);
}
{
	const t = open(2019, "Q1(d)");
	const [one, two] = t.c.parts.filter((p) => p.type === "battery");
	check(`${t.tag} circuit 2 gives more light in total`, t.P(two) > t.P(one) ? 1 : 0, 1);
	check(`${t.tag} circuit 1 total power, 144 ÷ 18 Ω`, t.P(one), 8);
	check(`${t.tag} circuit 2 total power, 144 ÷ 16 Ω`, t.P(two), 9);
}
{
	const t = open(2020, "Q1");
	check(`${t.tag} ammeter reads 3.5 A`, t.I(t.by("ammeter")), 3.5);
}
{
	const t = open(2020, "Q3(c)");
	check(`${t.tag} 5.6 A in the feeder wire`, t.I(t.by("ammeter")), 5.6);
}
{
	const t = open(2021, "Q1(a)");
	check(`${t.tag} current 0.667 A`, t.I(t.by("ammeter")), 2 / 3);
	check(`${t.tag} 8.00 V across the 12.0 Ω`, t.V(t.ohms(12)), 8);
	check(`${t.tag} heat in the 6.00 Ω in an hour`, t.P(t.ohms(6)) * 3600, (4 / 9) * 6 * 3600);
}
{
	const t = open(2021, "Q1(c)");
	check(`${t.tag} the lamp gets less than 8.00 V`, t.V(t.by("lamp")) < 8 ? 1 : 0, 1);
}
{
	const t = open(2021, "Q1(d)");
	const rp = (6 * 4.57) / 10.57;
	check(`${t.tag} voltage across the 4.57 Ω lamp`, t.V(t.by("lamp")), (12 * rp) / (12 + rp));
}
{
	const t = open(2022, "Q2(b)");
	check(`${t.tag} total resistance 2.53 Ω`, 12 / t.I(t.by("battery")), 1.31 + 1.22);
	const before = t.P(t.named("A"));
	const c = open(2022, "Q2(c)");
	check(`${c.tag} adding the radio brightens lamp A`, c.P(c.named("A")) > before ? 1 : 0, 1);
}
{
	const t = open(2022, "Q3(c)");
	check(`${t.tag} 3.53 A`, t.I(t.by("ammeter")), 12 / 3.4);
}
{
	const t = open(2023, "Q2");
	const top = (6.2 * 4.2) / 10.4;
	const bottom = (8.2 * 4.2) / 12.4;
	check(`${t.tag} top section 2.5 Ω`, top, 2.5, 0.01);
	check(`${t.tag} current from the supply`, t.I(t.by("ammeter")), 12 / (top + bottom));
	t.c.parts.filter((p) => p.name === "Bottom" && p.type === "lamp")[0].props.broken = true;
	t.rerun();
	const I = 12 / (top + 8.2);
	check(`${t.tag} bottom lamp out: heat in the 8.2 Ω in 2 minutes`, t.P(t.named("Bottom")) * 120, I * I * 8.2 * 120);
}
{
	const t = open(2023, "Q3");
	check(`${t.tag} current in the axle`, t.I(t.by("ammeter")), 120 / 42.1);
}
{
	const t = open(2024, "Q2");
	check(`${t.tag} 1.4 A in lamp D`, t.I(t.named("D")), 1.4, 0.01);
	check(`${t.tag} 0.70 A in lamp B`, t.I(t.named("B")), 0.7, 0.01);
	const before = t.P(t.named("D"));
	t.named("B").props.broken = true;
	t.rerun();
	check(`${t.tag} lamp B out: lamp D brighter`, t.P(t.named("D")) > before ? 1 : 0, 1);
}
{
	const t = open(2024, "Q3(d)");
	check(`${t.tag} each lamp at 6 V`, t.V(t.by("lamp")), 6);
	check(`${t.tag} 0.50 A along the boom`, t.I(t.by("battery")), 0.5);
}
{
	const t = open(2025, "Q2");
	check(`${t.tag} current in the lamp 0.24 A`, t.I(t.by("lamp")), 0.24);
	check(`${t.tag} ammeter with A closed, B open`, t.I(t.by("ammeter")), 7.74);
	t.named("B").props.closed = true;
	t.rerun();
	check(`${t.tag} element makes 1800 W`, t.P(t.named("Element")), 1800);
	check(`${t.tag} charge in 5 minutes`, t.I(t.by("ammeter")) * 300, 7.99 * 300);
	t.by("lamp").props.broken = true;
	t.rerun();
	check(`${t.tag} lamp out: ammeter reads 7.75 A`, t.I(t.by("ammeter")), 7.75);
	check(`${t.tag} …and the element still makes 1800 W`, t.P(t.named("Element")), 1800);
}
// Every circuit runs, and no lamp burns out just from being switched on.
for (const paper of PAPERS) {
	const c = paper.build();
	const sim = new Sim();
	sim.load(c);
	for (let k = 0; k < 60; k++) sim.advance(1 / 60, 1);
	const blown = c.parts.filter((p) => sim.states.get(p.id).blown);
	const ok = !blown.length && c.select !== undefined;
	if (!ok) failed++;
	if (!ok) console.log(`FAIL ${paper.year} ${paper.q} ${blown.length ? "burns out a lamp" : "has nothing selected"}`);
}
console.log(failed ? `\n${failed} failed` : `\nall ${PAPERS.length} circuits check out`);
process.exit(failed ? 1 : 0);

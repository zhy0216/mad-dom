// Positive fixture: concrete event-class constructor options.
// Covers: the T38 Event base completion and the first batch of concrete event
// classes (CustomEvent / UIEvent / MouseEvent / KeyboardEvent / FocusEvent /
// WheelEvent / InputEvent) with typed init dictionaries, readonly payload
// reads, static constants and EventPhaseEnum member comparisons.
// Must typecheck with ZERO diagnostics against BOTH dom-under-test targets.
import {
  CustomEvent,
  Event,
  EventPhaseEnum,
  FocusEvent,
  InputEvent,
  KeyboardEvent,
  MouseEvent,
  UIEvent,
  WheelEvent,
} from "dom-under-test";

const event = new Event("evt", { bubbles: true, cancelable: true });
const bubbles: boolean = event.bubbles;
const phase: number = event.eventPhase;
event.preventDefault();

const custom = new CustomEvent("ready", { bubbles: true, cancelable: true, detail: { attempt: 1 } });
const detail: { attempt: number } = custom.detail;
const customType: string = custom.type;
custom.initCustomEvent("renamed", false, false, { b: 2 });

const ui = new UIEvent("ui", { detail: 2 });
const detailNumber: number = ui.detail;

const mouse = new MouseEvent("click", {
  bubbles: true,
  screenX: 10,
  clientX: 30,
  button: 2,
  buttons: 4,
  ctrlKey: true,
  detail: 1,
});
const screenX: number = mouse.screenX;
const button: number = mouse.button;
const ctrl: boolean = mouse.ctrlKey;

const keyboard = new KeyboardEvent("keydown", {
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  location: 1,
  repeat: true,
  ctrlKey: true,
  isComposing: true,
});
const key: string = keyboard.key;
const location: number = keyboard.location;
const modifier: boolean = keyboard.getModifierState("Control") || keyboard.ctrlKey;
const locationLeft: number = KeyboardEvent.DOM_KEY_LOCATION_LEFT;

const focus = new FocusEvent("focus", { relatedTarget: null });
const relatedTarget = focus.relatedTarget;

const wheel = new WheelEvent("wheel", { deltaX: 1, deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
const deltaX: number = wheel.deltaX;
const deltaMode: number = wheel.deltaMode;

const input = new InputEvent("input", { data: "x", inputType: "insertText", isComposing: true });
const data: string = input.data;
const inputType: string = input.inputType;

const phaseEnum: number = EventPhaseEnum.capturing;

export const exported = {
  event,
  bubbles,
  phase,
  custom,
  detail,
  customType,
  ui,
  detailNumber,
  mouse,
  screenX,
  button,
  ctrl,
  keyboard,
  key,
  location,
  modifier,
  locationLeft,
  focus,
  relatedTarget,
  wheel,
  deltaX,
  deltaMode,
  input,
  data,
  inputType,
  phaseEnum,
};

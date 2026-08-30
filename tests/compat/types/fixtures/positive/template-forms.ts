// Positive fixture: the T40 template and first-batch form surface plus the
// T48C constraint-validation surface. The template content fragment, the
// input/button/select/option/textarea value/name/disabled/checked/selected
// basics, the form elements/submit/reset surface, the live options/elements
// collections, the window constructor accessors and the ValidityState /
// validity / willValidate / validationMessage / setCustomValidity /
// checkValidity / reportValidity surface. Must typecheck with ZERO diagnostics
// against BOTH dom-under-test targets.
import {
  DocumentFragment,
  HTMLButtonElement,
  HTMLCollection,
  HTMLFormControlsCollection,
  HTMLFormElement,
  HTMLInputElement,
  HTMLOptionElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
  HTMLElement,
  Window,
} from "dom-under-test";

const window = new Window();
const document = window.document;

// --- template ---
const template = document.createElement("template");
const content: DocumentFragment = template.content;
template.innerHTML = "<p>in</p>";
const templateHtml: string = template.innerHTML;
const templateGet: string = template.getHTML();

// --- input ---
const input = document.createElement("input") as HTMLInputElement;
input.value = "v";
const inputValue: string = input.value;
input.name = "n";
const inputName: string = input.name;
input.type = "checkbox";
const inputType: string = input.type;
input.disabled = true;
const inputDisabled: boolean = input.disabled;
input.checked = true;
const inputChecked: boolean = input.checked;
input.defaultChecked = true;
input.defaultValue = "d";
const inputRequired: boolean = input.required;
input.readOnly = true;
input.multiple = true;

// --- button ---
const button = document.createElement("button") as HTMLButtonElement;
button.value = "go";
const buttonValue: string = button.value;
button.type = "submit";
const buttonType: string = button.type;

// --- select / option ---
const select = document.createElement("select") as HTMLSelectElement;
select.value = "a";
const selectValue: string = select.value;
select.selectedIndex = 0;
const selectIndex: number = select.selectedIndex;
const options = select.options;
const optionsLength: number = options.length;
const firstOption: HTMLOptionElement | null = options.item(0);
const selectedOptions: HTMLCollection<HTMLOptionElement> = select.selectedOptions;
const selectLength: number = select.length;

const option = document.createElement("option") as HTMLOptionElement;
option.value = "a";
const optionValue: string = option.value;
option.selected = true;
const optionSelected: boolean = option.selected;
const optionIndex: number = option.index;
const optionText: string = option.text;
option.disabled = false;

// --- textarea ---
const textarea = document.createElement("textarea") as HTMLTextAreaElement;
textarea.value = "x";
const textareaValue: string = textarea.value;
const textareaDefault: string = textarea.defaultValue;

// --- form ---
const form = document.createElement("form") as HTMLFormElement;
const elements: HTMLFormControlsCollection = form.elements;
const elementsLength: number = elements.length;
const namedElement = elements.namedItem("n");
form.name = "f";
const formName: string = form.name;
form.method = "post";
const formMethod: string = form.method;
form.action = "/submit";
const formAction: string = form.action;
form.enctype = "text/plain";
form.acceptCharset = "utf-8";
form.noValidate = true;
form.submit();
form.requestSubmit(button);
form.reset();
const formValid: boolean = form.checkValidity();
const formReportValid: boolean = form.reportValidity();
const formLength: number = form.length;
const ownerForm: HTMLFormElement | null = input.form;

// --- constraint validation (T48C) ---
const validity = input.validity;
const valueMissing: boolean = input.validity.valueMissing;
const typeMismatch: boolean = input.validity.typeMismatch;
const patternMismatch: boolean = input.validity.patternMismatch;
const rangeUnderflow: boolean = input.validity.rangeUnderflow;
const rangeOverflow: boolean = input.validity.rangeOverflow;
const stepMismatch: boolean = input.validity.stepMismatch;
const tooLong: boolean = input.validity.tooLong;
const tooShort: boolean = input.validity.tooShort;
const badInput: boolean = input.validity.badInput;
const customError: boolean = input.validity.customError;
const validFlag: boolean = input.validity.valid;
const inputWillValidate: boolean = input.willValidate;
const inputValidationMessage: string = input.validationMessage;
input.setCustomValidity("custom");
const inputCheckValidity: boolean = input.checkValidity();
const inputReportValidity: boolean = input.reportValidity();
const inputFormNoValidate: boolean = input.formNoValidate;
const buttonFormNoValidate: boolean = button.formNoValidate;
const textareaValidity = textarea.validity;
const textareaWillValidate: boolean = textarea.willValidate;
const textareaMessage: string = textarea.validationMessage;
const textareaCheckValidity: boolean = textarea.checkValidity();
const selectValidity = select.validity;
const selectWillValidate: boolean = select.willValidate;
const selectMessage: string = select.validationMessage;
const selectCheckValidity: boolean = select.checkValidity();
const isValidityInstance: boolean = input.validity instanceof window.ValidityState;

// --- submit event ---
const submitEvent = new window.SubmitEvent("submit", {
  bubbles: true,
  cancelable: true,
  submitter: button,
});
const submitter: HTMLElement | null = submitEvent.submitter;

// --- window constructor accessors ---
const isTemplate: boolean = template instanceof window.HTMLTemplateElement;
const isForm: boolean = form instanceof window.HTMLFormElement;
const isInput: boolean = input instanceof window.HTMLInputElement;
const isSelect: boolean = select instanceof window.HTMLSelectElement;
const isOption: boolean = option instanceof window.HTMLOptionElement;
const isButton: boolean = button instanceof window.HTMLButtonElement;
const isTextarea: boolean = textarea instanceof window.HTMLTextAreaElement;

export const exported = {
  content,
  templateHtml,
  templateGet,
  inputValue,
  inputName,
  inputType,
  inputDisabled,
  inputChecked,
  inputRequired,
  buttonValue,
  buttonType,
  selectValue,
  selectIndex,
  optionsLength,
  firstOption,
  selectedOptions,
  selectLength,
  optionValue,
  optionSelected,
  optionIndex,
  optionText,
  textareaValue,
  textareaDefault,
  elementsLength,
  namedElement,
  formName,
  formMethod,
  formAction,
  formValid,
  formReportValid,
  formLength,
  ownerForm,
  validity,
  valueMissing,
  typeMismatch,
  patternMismatch,
  rangeUnderflow,
  rangeOverflow,
  stepMismatch,
  tooLong,
  tooShort,
  badInput,
  customError,
  validFlag,
  inputWillValidate,
  inputValidationMessage,
  inputCheckValidity,
  inputReportValidity,
  inputFormNoValidate,
  buttonFormNoValidate,
  textareaValidity,
  textareaWillValidate,
  textareaMessage,
  textareaCheckValidity,
  selectValidity,
  selectWillValidate,
  selectMessage,
  selectCheckValidity,
  isValidityInstance,
  submitter,
  isTemplate,
  isForm,
  isInput,
  isSelect,
  isOption,
  isButton,
  isTextarea,
};

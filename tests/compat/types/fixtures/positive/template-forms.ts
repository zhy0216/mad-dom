// Positive fixture: the T40 template and first-batch form surface. The
// template content fragment, the input/button/select/option/textarea
// value/name/disabled/checked/selected basics, the form elements/submit/reset
// surface, the live options/elements collections and the window constructor
// accessors. Must typecheck with ZERO diagnostics against BOTH dom-under-test
// targets.
import {
  DocumentFragment,
  HTMLCollection,
  HTMLFormControlsCollection,
  HTMLFormElement,
  HTMLOptionElement,
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
const input = document.createElement("input");
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
const button = document.createElement("button");
button.value = "go";
const buttonValue: string = button.value;
button.type = "submit";
const buttonType: string = button.type;

// --- select / option ---
const select = document.createElement("select");
select.value = "a";
const selectValue: string = select.value;
select.selectedIndex = 0;
const selectIndex: number = select.selectedIndex;
const options = select.options;
const optionsLength: number = options.length;
const firstOption: HTMLOptionElement | null = options.item(0);
const selectedOptions: HTMLCollection<HTMLOptionElement> = select.selectedOptions;
const selectLength: number = select.length;

const option = document.createElement("option");
option.value = "a";
const optionValue: string = option.value;
option.selected = true;
const optionSelected: boolean = option.selected;
const optionIndex: number = option.index;
const optionText: string = option.text;
option.disabled = false;

// --- textarea ---
const textarea = document.createElement("textarea");
textarea.value = "x";
const textareaValue: string = textarea.value;
const textareaDefault: string = textarea.defaultValue;

// --- form ---
const form = document.createElement("form");
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
const formLength: number = form.length;
const ownerForm: HTMLFormElement | null = input.form;

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
  formLength,
  ownerForm,
  submitter,
  isTemplate,
  isForm,
  isInput,
  isSelect,
  isOption,
  isButton,
  isTextarea,
};

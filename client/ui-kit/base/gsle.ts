import { LitElement } from "lit";
import { tw } from "../../shared/styles.ts";

export class GlobalStyledLitElement extends LitElement {
  static styles = [tw];
}

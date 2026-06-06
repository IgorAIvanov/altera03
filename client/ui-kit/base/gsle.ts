import { LitElement, css } from "lit";
import { tw } from "../../shared/styles.ts";

export class GlobalStyledLitElement extends LitElement {
  static styles = [css`:host { display: block; }`, tw];
}

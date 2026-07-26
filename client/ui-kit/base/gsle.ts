import { type CSSResultGroup, LitElement, css } from "lit";
import { tw } from "../../shared/styles.ts";

export class GlobalStyledLitElement extends LitElement {
  // Тип виписаний явно (тут і в решті базових класів) не для читача, а для
  // JSR: без нього публікація пакета йде «повільними типами» — без .d.ts.
  static override styles: CSSResultGroup = [css`:host { display: block; }`, tw];
}

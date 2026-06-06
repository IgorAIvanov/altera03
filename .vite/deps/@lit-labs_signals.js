import {
  _$LH,
  html,
  svg
} from "./chunk-ZRB6CQA3.js";
import {
  Signal
} from "./chunk-E3V3GIFD.js";

// node_modules/.deno/@lit-labs+signals@0.1.3/node_modules/@lit-labs/signals/development/lib/signal-watcher.js
var signalWatcherBrand = Symbol("SignalWatcherBrand");
var elementFinalizationRegistry = new FinalizationRegistry(({ watcher, signal: signal2 }) => {
  watcher.unwatch(signal2);
});
var elementForWatcher = /* @__PURE__ */ new WeakMap();
function SignalWatcher(Base) {
  if (Base[signalWatcherBrand] === true) {
    console.warn("SignalWatcher should not be applied to the same class more than once.");
    return Base;
  }
  class SignalWatcher2 extends Base {
    constructor() {
      super(...arguments);
      this.__forceUpdateSignal = new Signal.State(0);
      this.__forcingUpdate = false;
      this.__doFullRender = true;
      this.__pendingWatches = /* @__PURE__ */ new Set();
    }
    __watch() {
      if (this.__watcher !== void 0) {
        return;
      }
      this.__performUpdateSignal = new Signal.Computed(() => {
        this.__forceUpdateSignal.get();
        super.performUpdate();
      });
      const watcher = this.__watcher = new Signal.subtle.Watcher(function() {
        const el = elementForWatcher.get(this);
        if (el === void 0) {
          return;
        }
        if (el.__forcingUpdate === false) {
          el.requestUpdate();
        }
        this.watch();
      });
      elementForWatcher.set(watcher, this);
      elementFinalizationRegistry.register(this, {
        watcher,
        signal: this.__performUpdateSignal
      });
      watcher.watch(this.__performUpdateSignal);
    }
    __unwatch() {
      if (this.__watcher === void 0) {
        return;
      }
      this.__watcher.unwatch(this.__performUpdateSignal);
      this.__performUpdateSignal = void 0;
      this.__watcher = void 0;
    }
    performUpdate() {
      if (!this.isUpdatePending) {
        return;
      }
      this.__watch();
      this.__forcingUpdate = true;
      this.__forceUpdateSignal.set(this.__forceUpdateSignal.get() + 1);
      this.__forcingUpdate = false;
      this.__performUpdateSignal.get();
    }
    update(changedProperties) {
      try {
        if (this.__doFullRender) {
          this.__doFullRender = false;
          super.update(changedProperties);
        } else {
          this.__pendingWatches.forEach((d) => d.commit());
        }
      } finally {
        this.isUpdatePending = false;
        this.__pendingWatches.clear();
      }
    }
    requestUpdate(name, oldValue, options) {
      this.__doFullRender = true;
      super.requestUpdate(name, oldValue, options);
    }
    connectedCallback() {
      super.connectedCallback();
      this.requestUpdate();
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      queueMicrotask(() => {
        if (this.isConnected === false) {
          this.__unwatch();
        }
      });
    }
    /**
     * Enqueues an update caused by a signal change observed by a watch()
     * directive.
     *
     * Note: the method is not part of the public API and is subject to change.
     * In particular, it may be removed if the watch() directive is updated to
     * work with standalone lit-html templates.
     *
     * @internal
     */
    _updateWatchDirective(d) {
      this.__pendingWatches.add(d);
      const shouldRender = this.__doFullRender;
      this.requestUpdate();
      this.__doFullRender = shouldRender;
    }
    /**
     * Clears a watch() directive from the set of pending watches.
     *
     * Note: the method is not part of the public API and is subject to change.
     *
     * @internal
     */
    _clearWatchDirective(d) {
      this.__pendingWatches.delete(d);
    }
  }
  return SignalWatcher2;
}

// node_modules/.deno/lit-html@3.3.1/node_modules/lit-html/development/directive.js
var PartType = {
  ATTRIBUTE: 1,
  CHILD: 2,
  PROPERTY: 3,
  BOOLEAN_ATTRIBUTE: 4,
  EVENT: 5,
  ELEMENT: 6
};
var directive = (c) => (...values) => ({
  // This property needs to remain unminified.
  ["_$litDirective$"]: c,
  values
});
var Directive = class {
  constructor(_partInfo) {
  }
  // See comment in Disconnectable interface for why this is a getter
  get _$isConnected() {
    return this._$parent._$isConnected;
  }
  /** @internal */
  _$initialize(part, parent, attributeIndex) {
    this.__part = part;
    this._$parent = parent;
    this.__attributeIndex = attributeIndex;
  }
  /** @internal */
  _$resolve(part, props) {
    return this.update(part, props);
  }
  update(_part, props) {
    return this.render(...props);
  }
};

// node_modules/.deno/lit-html@3.3.1/node_modules/lit-html/development/directive-helpers.js
var { _ChildPart: ChildPart } = _$LH;
var ENABLE_SHADYDOM_NOPATCH = true;
var _a, _b;
var wrap = ENABLE_SHADYDOM_NOPATCH && ((_a = window.ShadyDOM) == null ? void 0 : _a.inUse) && ((_b = window.ShadyDOM) == null ? void 0 : _b.noPatch) === true ? window.ShadyDOM.wrap : (node) => node;
var isSingleExpression = (part) => part.strings === void 0;

// node_modules/.deno/lit-html@3.3.1/node_modules/lit-html/development/async-directive.js
var DEV_MODE = true;
var notifyChildrenConnectedChanged = (parent, isConnected) => {
  var _a2;
  const children = parent._$disconnectableChildren;
  if (children === void 0) {
    return false;
  }
  for (const obj of children) {
    (_a2 = obj["_$notifyDirectiveConnectionChanged"]) == null ? void 0 : _a2.call(obj, isConnected, false);
    notifyChildrenConnectedChanged(obj, isConnected);
  }
  return true;
};
var removeDisconnectableFromParent = (obj) => {
  let parent, children;
  do {
    if ((parent = obj._$parent) === void 0) {
      break;
    }
    children = parent._$disconnectableChildren;
    children.delete(obj);
    obj = parent;
  } while ((children == null ? void 0 : children.size) === 0);
};
var addDisconnectableToParent = (obj) => {
  for (let parent; parent = obj._$parent; obj = parent) {
    let children = parent._$disconnectableChildren;
    if (children === void 0) {
      parent._$disconnectableChildren = children = /* @__PURE__ */ new Set();
    } else if (children.has(obj)) {
      break;
    }
    children.add(obj);
    installDisconnectAPI(parent);
  }
};
function reparentDisconnectables(newParent) {
  if (this._$disconnectableChildren !== void 0) {
    removeDisconnectableFromParent(this);
    this._$parent = newParent;
    addDisconnectableToParent(this);
  } else {
    this._$parent = newParent;
  }
}
function notifyChildPartConnectedChanged(isConnected, isClearingValue = false, fromPartIndex = 0) {
  const value = this._$committedValue;
  const children = this._$disconnectableChildren;
  if (children === void 0 || children.size === 0) {
    return;
  }
  if (isClearingValue) {
    if (Array.isArray(value)) {
      for (let i = fromPartIndex; i < value.length; i++) {
        notifyChildrenConnectedChanged(value[i], false);
        removeDisconnectableFromParent(value[i]);
      }
    } else if (value != null) {
      notifyChildrenConnectedChanged(value, false);
      removeDisconnectableFromParent(value);
    }
  } else {
    notifyChildrenConnectedChanged(this, isConnected);
  }
}
var installDisconnectAPI = (obj) => {
  if (obj.type == PartType.CHILD) {
    obj._$notifyConnectionChanged ?? (obj._$notifyConnectionChanged = notifyChildPartConnectedChanged);
    obj._$reparentDisconnectables ?? (obj._$reparentDisconnectables = reparentDisconnectables);
  }
};
var AsyncDirective = class extends Directive {
  constructor() {
    super(...arguments);
    this._$disconnectableChildren = void 0;
  }
  /**
   * Initialize the part with internal fields
   * @param part
   * @param parent
   * @param attributeIndex
   */
  _$initialize(part, parent, attributeIndex) {
    super._$initialize(part, parent, attributeIndex);
    addDisconnectableToParent(this);
    this.isConnected = part._$isConnected;
  }
  // This property needs to remain unminified.
  /**
   * Called from the core code when a directive is going away from a part (in
   * which case `shouldRemoveFromParent` should be true), and from the
   * `setChildrenConnected` helper function when recursively changing the
   * connection state of a tree (in which case `shouldRemoveFromParent` should
   * be false).
   *
   * @param isConnected
   * @param isClearingDirective - True when the directive itself is being
   *     removed; false when the tree is being disconnected
   * @internal
   */
  ["_$notifyDirectiveConnectionChanged"](isConnected, isClearingDirective = true) {
    var _a2, _b2;
    if (isConnected !== this.isConnected) {
      this.isConnected = isConnected;
      if (isConnected) {
        (_a2 = this.reconnected) == null ? void 0 : _a2.call(this);
      } else {
        (_b2 = this.disconnected) == null ? void 0 : _b2.call(this);
      }
    }
    if (isClearingDirective) {
      notifyChildrenConnectedChanged(this, isConnected);
      removeDisconnectableFromParent(this);
    }
  }
  /**
   * Sets the value of the directive's Part outside the normal `update`/`render`
   * lifecycle of a directive.
   *
   * This method should not be called synchronously from a directive's `update`
   * or `render`.
   *
   * @param directive The directive to update
   * @param value The value to set
   */
  setValue(value) {
    if (isSingleExpression(this.__part)) {
      this.__part._$setValue(value, this);
    } else {
      if (DEV_MODE && this.__attributeIndex === void 0) {
        throw new Error(`Expected this.__attributeIndex to be a number`);
      }
      const newValues = [...this.__part._$committedValue];
      newValues[this.__attributeIndex] = value;
      this.__part._$setValue(newValues, this, 0);
    }
  }
  /**
   * User callbacks for implementing logic to release any resources/subscriptions
   * that may have been retained by this directive. Since directives may also be
   * re-connected, `reconnected` should also be implemented to restore the
   * working state of the directive prior to the next render.
   */
  disconnected() {
  }
  reconnected() {
  }
};

// node_modules/.deno/@lit-labs+signals@0.1.3/node_modules/@lit-labs/signals/development/lib/watch.js
var WatchDirective = class extends AsyncDirective {
  __watch() {
    if (this.__watcher !== void 0) {
      return;
    }
    this.__computed = new Signal.Computed(() => {
      var _a2;
      return (_a2 = this.__signal) === null || _a2 === void 0 ? void 0 : _a2.get();
    });
    const watcher = this.__watcher = new Signal.subtle.Watcher(() => {
      var _a2;
      (_a2 = this.__host) === null || _a2 === void 0 ? void 0 : _a2._updateWatchDirective(this);
      watcher.watch();
    });
    watcher.watch(this.__computed);
  }
  __unwatch() {
    var _a2;
    if (this.__watcher !== void 0) {
      this.__watcher.unwatch(this.__computed);
      this.__computed = void 0;
      this.__watcher = void 0;
      (_a2 = this.__host) === null || _a2 === void 0 ? void 0 : _a2._clearWatchDirective(this);
    }
  }
  commit() {
    this.setValue(Signal.subtle.untrack(() => {
      var _a2;
      return (_a2 = this.__computed) === null || _a2 === void 0 ? void 0 : _a2.get();
    }));
  }
  render(signal2) {
    return Signal.subtle.untrack(() => signal2.get());
  }
  update(part, [signal2]) {
    var _a2, _b2;
    (_a2 = this.__host) !== null && _a2 !== void 0 ? _a2 : this.__host = (_b2 = part.options) === null || _b2 === void 0 ? void 0 : _b2.host;
    if (signal2 !== this.__signal && this.__signal !== void 0) {
      this.__unwatch();
    }
    this.__signal = signal2;
    this.__watch();
    return Signal.subtle.untrack(() => this.__computed.get());
  }
  disconnected() {
    this.__unwatch();
  }
  reconnected() {
    this.__watch();
  }
};
var watch = directive(WatchDirective);

// node_modules/.deno/@lit-labs+signals@0.1.3/node_modules/@lit-labs/signals/development/lib/html-tag.js
var withWatch = (coreTag) => (strings, ...values) => {
  return coreTag(strings, ...values.map((v) => v instanceof Signal.State || v instanceof Signal.Computed ? watch(v) : v));
};
var html2 = withWatch(html);
var svg2 = withWatch(svg);

// node_modules/.deno/@lit-labs+signals@0.1.3/node_modules/@lit-labs/signals/development/index.js
var State = Signal.State;
var Computed = Signal.Computed;
var signal = (value, options) => new Signal.State(value, options);
var computed = (callback, options) => new Signal.Computed(callback, options);
export {
  Computed,
  Signal,
  SignalWatcher,
  State,
  WatchDirective,
  computed,
  html2 as html,
  signal,
  svg2 as svg,
  watch,
  withWatch
};
/*! Bundled license information:

@lit-labs/signals/development/lib/signal-watcher.js:
@lit-labs/signals/development/lib/watch.js:
@lit-labs/signals/development/lib/html-tag.js:
@lit-labs/signals/development/index.js:
  (**
   * @license
   * Copyright 2023 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/development/directive.js:
lit-html/development/async-directive.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/development/directive-helpers.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
//# sourceMappingURL=@lit-labs_signals.js.map

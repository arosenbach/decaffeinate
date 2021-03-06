import ArrayInitialiserPatcher from './ArrayInitialiserPatcher';
import BinaryOpPatcher from './BinaryOpPatcher';
import DynamicMemberAccessOpPatcher from './DynamicMemberAccessOpPatcher';
import FunctionApplicationPatcher from './FunctionApplicationPatcher';
import IdentifierPatcher from './IdentifierPatcher';
import MemberAccessOpPatcher from './MemberAccessOpPatcher';
import StringPatcher from './StringPatcher';
import type NodePatcher from './../../../patchers/NodePatcher';
import type { SourceToken, PatcherContext } from './../../../patchers/types';
import { SourceType } from 'coffee-lex';

/**
 * Handles `in` operators, e.g. `a in b` and `a not in b`.
 */
export default class InOpPatcher extends BinaryOpPatcher {
  negated: boolean;

  /**
   * `node` is of type `InOp`.
   */
  constructor(patcherContext: PatcherContext, left: NodePatcher, right: NodePatcher) {
    super(patcherContext, left, right);
    this.negated = patcherContext.node.isNot;
  }

  negate() {
    this.negated = !this.negated;
  }

  operatorTokenPredicate(): (token: SourceToken) => boolean {
    return (token: SourceToken) => token.type === SourceType.RELATION;
  }

  /**
   * LEFT 'in' RIGHT
   */
  patchAsExpression() {
    if (!this.left.isPure() || !this.right.isPure()) {
      this.patchWithLHSExtracted();
      return;
    }

    let rightCode = this.right.patchAndGetCode();
    if (this.shouldWrapInArrayFrom()) {
      rightCode = `Array.from(${rightCode})`;
    } else if (this.rhsNeedsParens()) {
      rightCode = `(${rightCode})`;
    }

    // `a in b` → `a`
    //   ^^^^^
    this.remove(this.left.outerEnd, this.right.outerEnd);

    if (this.negated) {
      // `a` → `!a`
      //        ^
      this.insert(this.left.outerStart, '!');
    }

    // `!a` → `!b.includes(a`
    //          ^^^^^^^^^^^
    this.insert(this.left.outerStart, `${rightCode}.includes(`);

    this.left.patch();

    // `!b.includes(a` → `!b.includes(a)`
    //                                 ^
    this.insert(this.left.outerEnd, ')');
  }

  patchWithLHSExtracted() {
    // `a() in b` → `(needle = a(), in b`
    //               ^^^^^^^^^^^^^^^
    this.insert(this.contentStart, '(');
    let leftRef = this.left.patchRepeatable({ ref: 'needle', forceRepeat: true });
    this.insert(this.left.outerEnd, `, `);

    // `(needle = a(), in b` → `(needle = a(), b`
    //                 ^^^
    this.remove(this.left.outerEnd, this.right.outerStart);

    // `(needle = a(), b` → `(needle = a(), !Array.from(b).includes(needle))`
    //                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    if (this.negated) {
      this.insert(this.right.outerStart, '!');
    }
    let wrapInArrayFrom = this.shouldWrapInArrayFrom();
    let rhsNeedsParens = wrapInArrayFrom || this.rhsNeedsParens();
    if (wrapInArrayFrom) {
      this.insert(this.right.outerStart, 'Array.from');
    }
    if (rhsNeedsParens) {
      this.insert(this.right.outerStart, '(');
    }
    this.right.patch();
    if (rhsNeedsParens) {
      this.insert(this.right.outerEnd, ')');
    }
    this.insert(this.right.outerEnd, `.includes(${leftRef}))`);
  }

  shouldWrapInArrayFrom() {
    if (this.options.looseIncludes) {
      return false;
    }
    return !(this.right instanceof ArrayInitialiserPatcher);
  }

  rhsNeedsParens() {
    // In typical cases, when converting `a in b` to `b.includes(a)`, parens
    // won't be necessary around the `b`, but to be safe, only skip the parens
    // in a specific set of known-good cases.
    return !(this.right instanceof IdentifierPatcher) &&
      !(this.right instanceof MemberAccessOpPatcher) &&
      !(this.right instanceof DynamicMemberAccessOpPatcher) &&
      !(this.right instanceof FunctionApplicationPatcher) &&
      !(this.right instanceof ArrayInitialiserPatcher) &&
      !(this.right instanceof StringPatcher);
  }

  /**
   * Method invocations don't need parens.
   */
  statementNeedsParens(): boolean {
    return false;
  }
}

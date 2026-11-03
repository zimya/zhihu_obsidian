import type { Element } from "hast";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import type { Processor } from "unified";

// Shared by the publisher and its regression tests, including the fork's
// support for inline $$...$$ expressions.
export function mathPlugin(this: Processor) {
    const data = this.data() as unknown as {
        micromarkExtensions?: ReturnType<typeof math>[];
        fromMarkdownExtensions?: ReturnType<typeof mathFromMarkdown>[];
        toMarkdownExtensions?: ReturnType<typeof mathToMarkdown>[];
    };
    (data.micromarkExtensions ||= []).push(math());
    (data.fromMarkdownExtensions ||= []).push(mathFromMarkdown());
    (data.toMarkdownExtensions ||= []).push(mathToMarkdown());
}

export function zhihuEquationUrl(eq: string): string {
    return `https://www.zhihu.com/equation?tex=${encodeURIComponent(eq)}`;
}

export function zhihuEquation(eq: string, display: boolean): Element {
    const image: Element = {
        type: "element",
        tagName: "img",
        properties: {
            eeimg: display ? "2" : "1",
            // array uses &, and equations may contain +, #, or %. Each must
            // remain part of the tex parameter rather than the surrounding URL.
            src: zhihuEquationUrl(eq).replace(/^https:/, ""),
            alt: eq.replace(/[\n\r]/g, " "),
        },
        children: [],
    };
    return display
        ? { type: "element", tagName: "p", properties: {}, children: [image] }
        : image;
}

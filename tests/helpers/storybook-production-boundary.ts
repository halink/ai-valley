import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const shellImports=new Set(['./storybook-ui-shell.js','./storybook-ui-shell.css']);
/** Exact presentation-only allowlist. Unknown future storybook modules stay opt-in. */
export function storybookProductionImportViolations(source:string,allowShell=false):string[]{
 const violations:string[]=[];
 const parsed=ts.createSourceFile('client.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const check=(expression:ts.Expression|undefined)=>{
  if(!expression||!ts.isStringLiteralLike(expression)){violations.push('nonliteral module reference');return;}
  const name=expression.text;
  if(name.includes('storybook-')&&!(allowShell&&shellImports.has(name)))violations.push(name);
 };
 const visit=(node:ts.Node)=>{
  if(ts.isImportDeclaration(node))check(node.moduleSpecifier);
  else if(ts.isExportDeclaration(node)&&node.moduleSpecifier)check(node.moduleSpecifier);
  else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))check(node.moduleReference.expression);
  else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))check(node.arguments[0]);
  // URLs/worker assets and aliased string paths must not bypass import checks.
  if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL')check(node.arguments?.[0]);
  if(ts.isStringLiteralLike(node)&&node.text.includes('storybook-')&&!(allowShell&&shellImports.has(node.text)))violations.push(node.text);
  if(ts.isTemplateExpression(node)&&[node.head,...node.templateSpans.map(span=>span.literal)].some(part=>part.text.includes('storybook-')))violations.push('storybook template module path');
  ts.forEachChild(node,visit);
 };
 visit(parsed);return [...new Set(violations)];
}
/** Inspect ALL emitted chunks, not only initial imports: lazy leakage is still leakage. */
export const productionStorybookModules=Object.freeze(['ts','css'].map(extension=>fileURLToPath(new URL(`../../src/client/storybook-ui-shell.${extension}`,import.meta.url)).replaceAll('\\','/')));
export function forbiddenStorybookProductionModules(ids:readonly string[]):string[]{
 return ids.filter(id=>id.includes('storybook-')&&!productionStorybookModules.includes(id.replaceAll('\\','/')));
}
export function forbiddenStorybookProductionAssets(names:readonly string[]):string[]{return names.filter(name=>name.includes('storybook-'));}

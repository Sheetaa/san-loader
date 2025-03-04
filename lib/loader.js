/**
 * Copyright (c) Baidu Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license.
 * See LICENSE file in the project root for license information.
 *
 * @file loader main
 * @author clark-t
 */

const qs = require('querystring');
const loaderUtils = require('loader-utils');
const aNodeUtils = require('san-anode-utils');
const parse = require('./utils/parse');
const {generateTemplateImport, getTemplateCode} = require('./blocks/template');
const {generateScriptImport, getScriptCode} = require('./blocks/script');
const {generateStyleImport, getStyleCode} = require('./blocks/style');

/**
 * San 单文件有效的标签块及其代码提取方法集合
 *
 * @const
 * @type {Object}
 */
const SAN_BLOCK_MAP = {
    template: getTemplateCode,
    script: getScriptCode,
    style: getStyleCode
};

/**
 * San 有效的标签块列表
 *
 * @const
 * @type {Array.<string>}
 */
const SAN_TAGNAMES = Object.keys(SAN_BLOCK_MAP);

/**
 * 根据参数从 San 单文件中获取标签块中代码的方法
 *
 * @param {Object} descriptor 分类好的代码块描述对象
 * @param {Object} options 参数
 * @return {Object} {code, map}
 */
function extract(descriptor, options) {
    let extractor = SAN_BLOCK_MAP[options.query.type];
    return extractor(descriptor, options);
}

function FakeComponent() {}
module.exports = function (source) {
    const loaderOptions = loaderUtils.getOptions(this);
    const {
        compileTemplate = 'none',
        esModule = false,
        autoAddScriptTag = true,
        autoFillStyleAndId = true,
        trimWhitespace = 'none',
        delimiters = ['{{', '}}']
    } = loaderOptions;

    const {descriptor, ast, postSource} = parse(source, SAN_TAGNAMES, this.resourcePath, autoAddScriptTag);
    const rawQuery = this.resourceQuery.slice(1);
    const query = qs.parse(rawQuery);
    // 连字符转驼峰
    for (const key in query) {
        if (Object.hasOwnProperty.call(query, key) && key.includes('-')) {
            const camelKey = key.replace(/\-(\w)/g, function (_, letter) {
                return letter.toUpperCase();
            });
            query[camelKey] = query[key];
        }
    }
    const options = {
        compileTemplate,
        source: postSource,
        resourcePath: this.resourcePath,
        needMap: this.sourceMap,
        query,
        ast,
        esModule,
        autoFillStyleAndId,
        trimWhitespace,
        delimiters
    };
    // 根据 type 等参数指定返回不同的代码块
    if (query && query.san === '' && query.type) {
        let {code, map} = extract(descriptor, options);
        // 处理compileTemplate情况
        if (query.type === 'template') {
            const compileTemplateTypes = ['aPack', 'aNode'];

            // 优先使用template上面的compileTemplate
            const compileTpl = query.compileTemplate || compileTemplate;
            if (compileTpl && compileTemplateTypes.includes(compileTpl)) {
                if (query.lang !== 'html') {
                    throw new Error('attribute `compileTemplate` can only used when `lang` is `html`');
                }

                let aNode;
                if (autoFillStyleAndId) {
                    FakeComponent.prototype.autoFillStyleAndId = autoFillStyleAndId;
                    FakeComponent.prototype.template = code;
                    FakeComponent.prototype.trimWhitespace = trimWhitespace;
                    FakeComponent.prototype.delimiters = delimiters;
                    aNode = aNodeUtils.parseComponentTemplate(FakeComponent);
                } else {
                    aNode = aNodeUtils.parseTemplate(code);
                }

                switch (compileTpl) {
                    case 'aNode':
                        code = aNode;
                        break;
                    case 'aPack':
                        if (aNode.children.length) {
                            let aPack = aNodeUtils.pack(autoFillStyleAndId ? aNode : aNode.children[0]);
                            code = aPack;
                        }
                        else {
                            code = [];
                        }

                        break;
                }
            }
        }
        if (this.sourceMap) {
            this.callback(null, code, map);
        }
        else {
            this.callback(null, code);
        }
        return;
    }
    // 生成入口文件
    let templateCode = generateTemplateImport(descriptor, options);
    let styleCode = generateStyleImport(descriptor, options);
    let scriptCode = generateScriptImport(descriptor, options);

    // runtime 模块路径
    const normalizePath = loaderUtils.stringifyRequest(this, require.resolve('./runtime/normalize'));
    let codo = `
        ${esModule ? `import normalize from ${normalizePath};` : `var normalize = require(${normalizePath});`}
        ${styleCode}
        ${templateCode}
        ${scriptCode}
        ${esModule ? 'export default' : 'module.exports.default ='} normalize(script, template, injectStyles);
        /* san-hmr component */
    `;
    this.callback(null, codo);
};

/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* globals ColorSpace, DeviceCmykCS, DeviceGrayCS, DeviceRgbCS, error,
           FONT_IDENTITY_MATRIX, IDENTITY_MATRIX, ImageData, isArray, isNum,
           isString, Pattern, TilingPattern, TODO, Util, warn, assert, info */

'use strict';

// Clips (primitive) objects inside the PDF page
var ObjectClipper = (function ObjectClipper_closure() {
  function ObjectClipper(state) {
    this.reset(state);
  }
  
  ObjectClipper.prototype = {
    reset: function(state) {
      this.boundingBox = new BoundingBox(0, 0, 0, 0);
      this.outerBoundingBox = new BoundingBox(-1e11, -1e11, 2e11, 2e11);
      this.isActive = false;
      this.stateStack = [state];
      this.stackptr = 0;
      this.commandList = [];
    },
    
    addCommand: function(command) {
      if (command.name === "paintInlineImageXObject" || command.name === "paintInlineImageXObjectGroup") {
        // Replace first argument with IR
        var imgData = command.args[0];
        command.args = command.args.slice(0);
        command.args[0] = PDFImageData.toIR(imgData);
      }
      this.commandList.push(command);
    },
    
    extendPoint: function(pt, transform) {
      if (transform) {
        var aNewPt = Util.applyTransform([pt.x, pt.y], transform);
        pt = { x: aNewPt[0], y: aNewPt[1] };
      }
      if (this.isActive) {
        this.boundingBox.extendPoint(pt);
      } else {
        this.boundingBox.left = pt.x;
        this.boundingBox.top = pt.y;
        this.boundingBox.width = 0;
        this.boundingBox.height = 0;
        this.isActive = true;
      }
    },
    
    extendBoundingBox: function(bb) {
      this.extendPoint({ x: bb.left, y: bb.top });
      this.extendPoint({ x: bb.right, y: bb.bottom });
    },
    
    clip: function() {
      this.outerBoundingBox = this.boundingBox;
      this.boundingBox = new BoundingBox(0, 0, 0, 0);
      this.isActive = false;
    },
    
    restrictBoundingBox: function() {
      this.boundingBox.restrict(this.outerBoundingBox);
    },
    
    onSave: function() {
      this.stackptr++;
    },
    
    onRestore: function(state) {
      // stack underflow, should save the current context state after the restore
      if (this.stackptr == 0)
        this.stateStack.splice(0, 0, state);
      else
        this.stackptr--;
    }
  };
  
  return ObjectClipper;
})();

var DepAnalyzer = (function DepAnalyzer_closure() {
  function DepAnalyzer() {
    this.reset();
  };
  
  DepAnalyzer.prototype = {
    reset: function() {
      this.dependency = null;
    },
    
    _getDependency: function() {
      return this.dependency || (this.dependency = {
        fonts: { __proto__: null },
        images: { __proto__: null }
      });
    },
    
    addFontDependency: function(refName) {
      this._getDependency().fonts[refName] = true;
    },
    
    addImageDependency: function(refName) {
      this._getDependency().images[refName] = true;
    },
  };
  
  return DepAnalyzer;
})();

// <canvas> contexts store most of the state we need natively.
// However, PDF needs a bit more state, which we store here.

var TextRenderingMode = {
  FILL: 0,
  STROKE: 1,
  FILL_STROKE: 2,
  INVISIBLE: 3,
  FILL_ADD_TO_PATH: 4,
  STROKE_ADD_TO_PATH: 5,
  FILL_STROKE_ADD_TO_PATH: 6,
  ADD_TO_PATH: 7,
  FILL_STROKE_MASK: 3,
  ADD_TO_PATH_FLAG: 4
};

// Minimal font size that would be used during canvas fillText operations.
var MIN_FONT_SIZE = 16;

var COMPILE_TYPE3_GLYPHS = true;

function createScratchCanvas(width, height) {
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function addContextCurrentTransform(ctx) {
  // If the context doesn't expose a `mozCurrentTransform`, add a JS based on.
  if (!ctx.mozCurrentTransform) {
    // Store the original context
    ctx._scaleX = ctx._scaleX || 1.0;
    ctx._scaleY = ctx._scaleY || 1.0;
    ctx._originalSave = ctx.save;
    ctx._originalRestore = ctx.restore;
    ctx._originalRotate = ctx.rotate;
    ctx._originalScale = ctx.scale;
    ctx._originalTranslate = ctx.translate;
    ctx._originalTransform = ctx.transform;
    ctx._originalSetTransform = ctx.setTransform;

    ctx._transformMatrix = [ctx._scaleX, 0, 0, ctx._scaleY, 0, 0];
    ctx._transformStack = [];

    Object.defineProperty(ctx, 'mozCurrentTransform', {
      get: function getCurrentTransform() {
        return this._transformMatrix;
      }
    });

    Object.defineProperty(ctx, 'mozCurrentTransformInverse', {
      get: function getCurrentTransformInverse() {
        // Calculation done using WolframAlpha:
        // http://www.wolframalpha.com/input/?
        //   i=Inverse+{{a%2C+c%2C+e}%2C+{b%2C+d%2C+f}%2C+{0%2C+0%2C+1}}

        var m = this._transformMatrix;
        var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5];

        var ad_bc = a * d - b * c;
        var bc_ad = b * c - a * d;

        return [
          d / ad_bc,
          b / bc_ad,
          c / bc_ad,
          a / ad_bc,
          (d * e - c * f) / bc_ad,
          (b * e - a * f) / ad_bc
        ];
      }
    });

    ctx.save = function ctxSave() {
      var old = this._transformMatrix;
      this._transformStack.push(old);
      this._transformMatrix = old.slice(0, 6);

      this._originalSave();
    };

    ctx.restore = function ctxRestore() {
      var prev = this._transformStack.pop();
      if (prev) {
        this._transformMatrix = prev;
        this._originalRestore();
      }
    };

    ctx.translate = function ctxTranslate(x, y) {
      var m = this._transformMatrix;
      m[4] = m[0] * x + m[2] * y + m[4];
      m[5] = m[1] * x + m[3] * y + m[5];

      this._originalTranslate(x, y);
    };

    ctx.scale = function ctxScale(x, y) {
      var m = this._transformMatrix;
      m[0] = m[0] * x;
      m[1] = m[1] * x;
      m[2] = m[2] * y;
      m[3] = m[3] * y;

      this._originalScale(x, y);
    };

    ctx.transform = function ctxTransform(a, b, c, d, e, f) {
      var m = this._transformMatrix;
      this._transformMatrix = [
        m[0] * a + m[2] * b,
        m[1] * a + m[3] * b,
        m[0] * c + m[2] * d,
        m[1] * c + m[3] * d,
        m[0] * e + m[2] * f + m[4],
        m[1] * e + m[3] * f + m[5]
      ];

      ctx._originalTransform(a, b, c, d, e, f);
    };

    ctx.setTransform = function ctxSetTransform(a, b, c, d, e, f) {
      this._transformMatrix = [a, b, c, d, e, f];

      ctx._originalSetTransform(a, b, c, d, e, f);
    };

    ctx.rotate = function ctxRotate(angle) {
      var cosValue = Math.cos(angle);
      var sinValue = Math.sin(angle);

      var m = this._transformMatrix;
      this._transformMatrix = [
        m[0] * cosValue + m[2] * sinValue,
        m[1] * cosValue + m[3] * sinValue,
        m[0] * (-sinValue) + m[2] * cosValue,
        m[1] * (-sinValue) + m[3] * cosValue,
        m[4],
        m[5]
      ];

      this._originalRotate(angle);
    };
  }
}

var CachedCanvases = (function CachedCanvasesClosure() {
  var cache = {};
  return {
    getCanvas: function CachedCanvases_getCanvas(id, width, height) {
      var canvas;
      if (id in cache) {
        canvas = cache[id];
        canvas.width = width;
        canvas.height = height;
        // reset canvas transform for emulated mozCurrentTransform, if needed
        canvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
      } else {
        canvas = createScratchCanvas(width, height);
        cache[id] = canvas;
      }
      return canvas;
    },
    clear: function () {
      cache = {};
    }
  };
})();

function compileType3Glyph(imgData) {
  var POINT_TO_PROCESS_LIMIT = 1000;

  var width = imgData.width, height = imgData.height;
  var i, j, j0, width1 = width + 1;
  var points = new Uint8Array(width1 * (height + 1));
  var POINT_TYPES =
      new Uint8Array([0, 2, 4, 0, 1, 0, 5, 4, 8, 10, 0, 8, 0, 2, 1, 0]);
  // finding iteresting points: every point is located between mask pixels,
  // so there will be points of the (width + 1)x(height + 1) grid. Every point
  // will have flags assigned based on neighboring mask pixels:
  //   4 | 8
  //   --P--
  //   2 | 1
  // We are interested only in points with the flags:
  //   - outside corners: 1, 2, 4, 8;
  //   - inside corners: 7, 11, 13, 14;
  //   - and, intersections: 5, 10.
  var pos = 3, data = imgData.data, lineSize = width * 4, count = 0;
  if (data[3] !== 0) {
    points[0] = 1;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 4]) {
      points[j] = data[pos] ? 2 : 1;
      ++count;
    }
    pos += 4;
  }
  if (data[pos] !== 0) {
    points[j] = 2;
    ++count;
  }
  pos += 4;
  for (i = 1; i < height; i++) {
    j0 = i * width1;
    if (data[pos - lineSize] !== data[pos]) {
      points[j0] = data[pos] ? 1 : 8;
      ++count;
    }
    // 'sum' is the position of the current pixel configuration in the 'TYPES'
    // array (in order 8-1-2-4, so we can use '>>2' to shift the column).
    var sum = (data[pos] ? 4 : 0) + (data[pos - lineSize] ? 8 : 0);
    for (j = 1; j < width; j++) {
      sum = (sum >> 2) + (data[pos + 4] ? 4 : 0) +
            (data[pos - lineSize + 4] ? 8 : 0);
      if (POINT_TYPES[sum]) {
        points[j0 + j] = POINT_TYPES[sum];
        ++count;
      }
      pos += 4;
    }
    if (data[pos - lineSize] !== data[pos]) {
      points[j0 + j] = data[pos] ? 2 : 4;
      ++count;
    }
    pos += 4;

    if (count > POINT_TO_PROCESS_LIMIT) {
      return null;
    }
  }

  pos -= lineSize;
  j0 = i * width1;
  if (data[pos] !== 0) {
    points[j0] = 8;
    ++count;
  }
  for (j = 1; j < width; j++) {
    if (data[pos] !== data[pos + 4]) {
      points[j0 + j] = data[pos] ? 4 : 8;
      ++count;
    }
    pos += 4;
  }
  if (data[pos] !== 0) {
    points[j0 + j] = 4;
    ++count;
  }
  if (count > POINT_TO_PROCESS_LIMIT) {
    return null;
  }

  // building outlines
  var steps = new Int32Array([0, width1, -1, 0, -width1, 0, 0, 0, 1]);
  var outlines = [];
  for (i = 0; count && i <= height; i++) {
    var p = i * width1;
    var end = p + width;
    while (p < end && !points[p]) {
      p++;
    }
    if (p === end) {
      continue;
    }
    var coords = [p % width1, i];

    var type = points[p], p0 = p, pp;
    do {
      var step = steps[type];
      do { p += step; } while (!points[p]);

      pp = points[p];
      if (pp !== 5 && pp !== 10) {
        // set new direction
        type = pp;
        // delete mark
        points[p] = 0;
      } else { // type is 5 or 10, ie, a crossing
        // set new direction
        type = pp & ((0x33 * type) >> 4);
        // set new type for "future hit"
        points[p] &= (type >> 2 | type << 2);
      }

      coords.push(p % width1);
      coords.push((p / width1) | 0);
      --count;
    } while (p0 !== p);
    outlines.push(coords);
    --i;
  }

  var drawOutline = function(c) {
    c.save();
    // the path shall be painted in [0..1]x[0..1] space
    c.scale(1 / width, -1 / height);
    c.translate(0, -height);
    c.beginPath();
    for (var i = 0, ii = outlines.length; i < ii; i++) {
      var o = outlines[i];
      c.moveTo(o[0], o[1]);
      for (var j = 2, jj = o.length; j < jj; j += 2) {
        c.lineTo(o[j], o[j+1]);
      }
    }
    c.fill();
    c.beginPath();
    c.restore();
  };

  return drawOutline;
}

var CanvasExtraState = (function CanvasExtraStateClosure() {
  function CanvasExtraState(old) {
    // Are soft masks and alpha values shapes or opacities?
    this.alphaIsShape = false;
    this.fontRefName = null;
    this.fontSize = 0;
    this.fontSizeScale = 1;
    this.textMatrix = IDENTITY_MATRIX;
    this.fontMatrix = FONT_IDENTITY_MATRIX;
    this.leading = 0;
    // Current point (in user coordinates)
    this.x = 0;
    this.y = 0;
    // Start of text line (in text coordinates)
    this.lineX = 0;
    this.lineY = 0;
    // Character and word spacing
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.textHScale = 1;
    this.textRenderingMode = TextRenderingMode.FILL;
    this.textRise = 0;
    // Color spaces
    this.fillColorSpace = new DeviceGrayCS();
    this.fillColorSpaceObj = null;
    this.strokeColorSpace = new DeviceGrayCS();
    this.strokeColorSpaceObj = null;
    this.fillColorObj = null;
    this.strokeColorObj = null;
    // Default fore and background colors
    this.fillColor = '#000000';
    this.strokeColor = '#000000';
    // Note: fill alpha applies to all non-stroking operations
    this.fillAlpha = 1;
    this.strokeAlpha = 1;
    this.lineWidth = 1;
    this.paintFormXObjectDepth = 0;

    this.old = old;
  }
  
  CanvasExtraState.prototype = {
    clone: function CanvasExtraState_clone() {
      return Object.create(this);
    },
    setCurrentPoint: function CanvasExtraState_setCurrentPoint(x, y) {
      this.x = x;
      this.y = y;
    }
  };
  return CanvasExtraState;
})();

var CanvasGraphics = (function CanvasGraphicsClosure() {
  // Defines the time the executeOperatorList is going to be executing
  // before it stops and shedules a continue of execution.
  var EXECUTION_TIME = 15;

  function CanvasGraphics(canvasCtx, commonObjs, objs, textLayer, bbLayer, imageLayer) {
    this.ctx = canvasCtx;
    this.current = new CanvasExtraState();
    this.stateStack = [];
    this.pendingClip = null;
    this.pendingEOFill = false;
    this.res = null;
    this.xobjs = null;
    this.commonObjs = commonObjs;
    this.objs = objs;
    this.textLayer = textLayer;
    this.bbLayer = bbLayer;
    this.imageLayer = imageLayer;
    this.groupStack = [];
    this.processingType3 = null;
    if (canvasCtx) {
      addContextCurrentTransform(canvasCtx);
    }
  }

  function putBinaryImageData(ctx, imgData) {
    if (typeof ImageData !== 'undefined' && imgData instanceof ImageData) {
      ctx.putImageData(imgData, 0, 0);
      return;
    }

    var tmpImgData = ctx.createImageData(imgData.width, imgData.height);

    var data = imgData.data;
    var tmpImgDataPixels = tmpImgData.data;
    if ('set' in tmpImgDataPixels)
      tmpImgDataPixels.set(data);
    else {
      // Copy over the imageData pixel by pixel.
      for (var i = 0, ii = tmpImgDataPixels.length; i < ii; i++)
        tmpImgDataPixels[i] = data[i];
    }

    ctx.putImageData(tmpImgData, 0, 0);
  }

  CanvasGraphics.putBinaryImageData = putBinaryImageData;
  
  function copyCtxState(sourceCtx, destCtx) {
    var properties = ['strokeStyle', 'fillStyle', 'fillRule', 'globalAlpha',
                      'lineWidth', 'lineCap', 'lineJoin', 'miterLimit',
                      'globalCompositeOperation', 'font'];
    for (var i = 0, ii = properties.length; i < ii; i++) {
      var property = properties[i];
      if (property in sourceCtx) {
        destCtx[property] = sourceCtx[property];
      }
    }
    if ('setLineDash' in sourceCtx) {
      destCtx.setLineDash(sourceCtx.getLineDash());
      destCtx.lineDashOffset =  sourceCtx.lineDashOffset;
    } else if ('mozDash' in sourceCtx) {
      destCtx.mozDash = sourceCtx.mozDash;
      destCtx.mozDashOffset = sourceCtx.mozDashOffset;
    }
  }

  var ctxProps = ['strokeStyle', 'fillStyle', 'fillRule', 'globalAlpha',
                  'lineWidth', 'lineCap', 'lineJoin', 'miterLimit',
                  'globalCompositeOperation', 'font'];
  var ctxExtraProps = ["alphaIsShape", "fontSize", "fontSizeScale", "textMatrix",
                      "fontMatrix", "leading", "x", "y", "lineX", "lineY",
                      "charSpacing", "wordSpacing", "textHScale",
                      "textRenderingMode", "textRise", "fillAlpha",
                      "strokeAlpha", "lineWidth", "paintFormXObjectDepth",
                      "fontRefName"];
  var ctxExtraColorProps = { "fillColor": "fillColorSpace", "strokeColor": "strokeColorSpace" };
  
  /**
   * See http://html5.litten.com/understanding-save-and-restore-for-the-canvas-context/
   * Each context maintains a stack of drawing states. Drawing states consist of:
   *  * The current transformation matrix.
   *  * The current clipping region.
   *  * The current values of the following attributes: strokeStyle, fillStyle,
   *    globalAlpha, lineWidth, lineCap, lineJoin, miterLimit, shadowOffsetX,
   *    shadowOffsetY, shadowBlur, shadowColor, globalCompositeOperation, font,
   *    textAlign, textBaseline.
   *
   * The current path and the current bitmap are not part of the drawing state.
   * The current path is persistent, and can only be reset using the beginPath()
   * method. The current bitmap is a property of the canvas, not the context.
   *
   * We currently cannot save the current clipping region of the 2d context,
   * which might cause redrawn objects appear outside of its clipping region in
   * some scenarios.
   */
  function getFullContextState(sourceCtx, sourceExtraState) {
    var obj = {};
    // Copy sourceCtx properties
    for (var i = 0, l = ctxProps.length; i < l; i++) {
      var prop = ctxProps[i];
      if (prop in sourceCtx)
        obj[prop] = sourceCtx[prop];
    }
    if ("getLineDash" in sourceCtx) {
      obj.lineDash =  sourceCtx.getLineDash();
      obj.lineDashOffset = sourceCtx.lineDashOffset;
    } else {
      obj.lineDash = sourceCtx.mozDash;
      obj.lineDashOffset = sourceCtx.mozDashOffset;
    }
    obj.mozCurrentTransform = sourceCtx.mozCurrentTransform;
    // Copy sourceExtraState properties
    for (var i = 0, l = ctxExtraProps.length; i < l; i++) {
      var prop = ctxExtraProps[i];
      if (prop in sourceExtraState)
        obj[prop] = sourceExtraState[prop];
    }
    for (var prop in ctxExtraColorProps) {
      var color = sourceExtraState[prop];
      if (color.toIR) {
        obj[prop] = color.toIR();
      } else if (color.getIR) {
        obj[prop] = color.getIR();
      } else {
        obj[prop] = color;
      }
    }
    
    obj.fillColorSpace = sourceExtraState.fillColorSpace.toIR();
    obj.strokeColorSpace = sourceExtraState.strokeColorSpace.toIR();
    
    return obj;
  }
  
  function setFullContextState(ctx, extraState, fullState) {
    // Copy ctx properties
    for (var i = 0, l = ctxProps.length; i < l; i++) {
      var prop = ctxProps[i];
      if (prop in fullState)
        ctx[prop] = fullState[prop];
    }
    if ("setLineDash" in ctx) {
      ctx.setLineDash(fullState.lineDash);
      ctx.lineDashOffset = fullState.lineDashOffset;
    } else {
      ctx.mozDash = fullState.lineDash;
      ctx.mozDashOffset = fullState.lineDashOffset;
    }
    ctx.setTransform.apply(ctx, fullState.mozCurrentTransform);
    // Copy extraState properties
    for (var i = 0, l = ctxExtraProps.length; i < l; i++) {
      var prop = ctxExtraProps[i];
      if (prop in fullState)
        extraState[prop] = fullState[prop];
    }
    for (var prop in ctxExtraColorProps) {
      // Keep IR, will convert to object in the setFullContextState member function
      extraState[prop] = fullState[prop];
    }
    extraState.fillColorSpace = ColorSpace.fromIR(fullState.fillColorSpace);
    extraState.strokeColorSpace = ColorSpace.fromIR(fullState.strokeColorSpace);
  }

  var LINE_CAP_STYLES = ['butt', 'round', 'square'];
  var LINE_JOIN_STYLES = ['miter', 'round', 'bevel'];
  var NORMAL_CLIP = {};
  var EO_CLIP = {};
  var TermCommandType = {
    TEXT: 0,
    PRIMITIVE: 1,
    IMAGE: 2,
    FORMXOBJECT: 3,
    OTHER: 4
  };

  CanvasGraphics.prototype = {
    getFullContextState: function() {
      return getFullContextState(this.ctx, this.current);
    },
    setFullContextState: function(fullState, transform) {
      setFullContextState(this.ctx, this.current, fullState);
      for (var prop in ctxExtraColorProps) {
        var csprop = ctxExtraColorProps[prop];
        var cs = this.current[csprop];
        if (cs.name == "Pattern")
          this.current[prop] = this.getColorN_Pattern(this.current[prop], cs);
      }
      var fontRefName = this.current.fontRefName;
      if (fontRefName && this.commonObjs.isResolved(fontRefName)) {
        this.setFont(fontRefName, this.current.fontSize);
      }
      if (transform) {
        this.ctx.setTransform.apply(this.ctx, Util.transformAll(this.ctx.mozCurrentTransform, transform));
      }
    },
    setFullContextStateStack: function(stateStack, transform) {
      for (var stackptr = 0, l = stateStack.length; stackptr < l; stackptr++) {
        if (stackptr !== 0)
          this.save();
        var fullState = stateStack[stackptr];
        this.setFullContextState(fullState, transform);
      }
    },
    slowCommands: {
      'stroke': true,
      'closeStroke': true,
      'fill': true,
      'eoFill': true,
      'fillStroke': true,
      'eoFillStroke': true,
      'closeFillStroke': true,
      'closeEOFillStroke': true,
      'showText': true,
      'showSpacedText': true,
      'setStrokeColorSpace': true,
      'setFillColorSpace': true,
      'setStrokeColor': true,
      'setStrokeColorN': true,
      'setFillColor': true,
      'setFillColorN': true,
      'setStrokeGray': true,
      'setFillGray': true,
      'setStrokeRGBColor': true,
      'setFillRGBColor': true,
      'setStrokeCMYKColor': true,
      'setFillCMYKColor': true,
      'paintJpegXObject': true,
      'paintImageXObject': true,
      'paintInlineImageXObject': true,
      'paintInlineImageXObjectGroup': true,
      'paintImageMaskXObject': true,
      'paintImageMaskXObjectGroup': true,
      'shadingFill': true
    },
    
    terminatingCommands: {
      "dependency": TermCommandType.OTHER,
      "showText": TermCommandType.TEXT,
      "showSpacedText": TermCommandType.TEXT,
      "nextLineShowText": TermCommandType.TEXT,
      "nextLineSetSpacingShowText": TermCommandType.TEXT,
      "endText": TermCommandType.TEXT,
      "clip": TermCommandType.PRIMITIVE,
      "eoClip": TermCommandType.PRIMITIVE,
      "stroke": TermCommandType.PRIMITIVE,
      "closeStroke": TermCommandType.PRIMITIVE,
      "fill": TermCommandType.PRIMITIVE,
      "eoFill": TermCommandType.PRIMITIVE,
      "fillStroke": TermCommandType.PRIMITIVE,
      "eoFillStroke": TermCommandType.PRIMITIVE,
      "closeFillStroke": TermCommandType.PRIMITIVE,
      "closeEOFillStroke": TermCommandType.PRIMITIVE,
      "shadingFill": TermCommandType.PRIMITIVE,
      "endPath": TermCommandType.PRIMITIVE,
      "setCharWidthAndBounds": TermCommandType.PRIMITIVE,
      "paintXObject": TermCommandType.IMAGE,
      "paintJpegXObject": TermCommandType.IMAGE,
      "paintImageXObject": TermCommandType.IMAGE,
      "paintInlineImageXObject": TermCommandType.IMAGE,
      "paintInlineImageXObjectGroup": TermCommandType.IMAGE,
      "paintImageMaskXObject": TermCommandType.IMAGE,
      "paintImageMaskXObjectGroup": TermCommandType.IMAGE,
      "paintFormXObjectEnd": TermCommandType.FORMXOBJECT,
    },

    stateCommands: {
      // Graphics state
      "save": true,
      "restore": true,
      "setLineWidth": true,
      "setLineCap": true,
      "setLineJoin": true,
      "setMiterLimit": true,
      "setDash": true,
      "setRenderingIntent": true,
      "setFlatness": true,
      "setGState": true,
      "transform": true,
      // Text
      "beginText": true,
      "endText": false,
      "setCharSpacing": true,
      "setWordSpacing": true,
      "setHScale": true,
      "setLeading": true,
      "setFont": true,
      "setTextRenderingMode": true,
      "setTextRise": true,
      "moveText": true,
      "setLeadingMoveText": true,
      "setTextMatrix": true,
      "nextLine": true,
      // Type3 fonts
      "setCharWidth": true,
      "setCharWidthAndBounds": false,
      // Color
      "setStrokeColorSpace": true,
      "setFillColorSpace": true,
      "setStrokeColor": true,
      "setStrokeColorN": true,
      "setFillColor": true,
      "setFillColorN": true,
      "setStrokeGray": true,
      "setFillGray": true,
      "setStrokeRGBColor": true,
      "setFillRGBColor": true,
      "setStrokeCMYKColor": true,
      "setFillCMYKColor": true,
      // Marked content
      "markPoint": true,
      "markPointProps": true,
      "beginMarkedContent": true,
      "beginMarkedContentProps": true,
      "endMarkedContent": true,
    },
    
    // Object clipper
    recordObject: function CanvasGraphics_recordObject(type, transparency) {
      var clipper = this.clipper;
      this.clipper.restrictBoundingBox();
      if (!clipper.isActive || (clipper.boundingBox.width == 0 && clipper.boundingBox.height == 0))
        return;
        
      var bb = clipper.boundingBox;
      if (bb.width == 0) bb.width = 1;
      else if (bb.height == 0) bb.height = 1;
        
      var bbLayer = this.bbLayer;
      var bbtype;
      switch (type) {
      case TermCommandType.TEXT:
        bbtype = BoundingBoxType.PRIMITIVE_TEXT;
        break;
      case TermCommandType.IMAGE:
        bbtype = BoundingBoxType.IMAGE;
        break;
      case TermCommandType.PRIMITIVE:
      default:
        bbtype = BoundingBoxType.PRIMITIVE;
        break;
      }
      var content = {
        type: bbtype,
        stateStack: clipper.stateStack,
        commands: clipper.commandList,
        transparency: transparency
      };
      if (this.depAnalyzer.dependency)
        content.dependency = this.depAnalyzer.dependency;
      bbLayer.appendBoundingBox(clipper.boundingBox, content);
    },

    beginDrawing: function CanvasGraphics_beginDrawing(viewport, transparency) {
      // For pdfs that use blend modes we have to clear the canvas else certain
      // blend modes can look wrong since we'd be blending with a white
      // backdrop. The problem with a transparent backdrop though is we then
      // don't get sub pixel anti aliasing on text, so we fill with white if
      // we can.
      var width = this.ctx.canvas.width;
      var height = this.ctx.canvas.height;
      if (transparency) {
        this.ctx.clearRect(0, 0, width, height);
      } else {
        this.ctx.mozOpaque = true;
        this.ctx.save();
        this.ctx.fillStyle = 'rgb(255, 255, 255)';
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.restore();
      }

      var transform = viewport.transform;
      this.ctx.save();
      this.ctx.transform.apply(this.ctx, transform);

      if (this.textLayer) {
        this.textLayer.beginLayout();
      }
      if (this.bbLayer) {
        this.bbLayer.beginLayout();
        this.clipper = new ObjectClipper(null);
        this.depAnalyzer = new DepAnalyzer();
      }
      if (this.imageLayer) {
        this.imageLayer.beginLayout();
      }
    },

    executeOperatorList: function CanvasGraphics_executeOperatorList(
                                    operatorList,
                                    executionStartIdx, continueCallback,
                                    stepper) {
      var argsArray = operatorList.argsArray;
      var fnArray = operatorList.fnArray;
      var i = executionStartIdx || 0;
      var argsArrayLen = argsArray.length;

      // Sometimes the OperatorList to execute is empty.
      if (argsArrayLen == i) {
        return i;
      }

      var executionEndIdx;
      var endTime = Date.now() + EXECUTION_TIME;

      var commonObjs = this.commonObjs;
      var objs = this.objs;
      var fnName;
      var slowCommands = this.slowCommands;
      var termCommands = this.terminatingCommands;
      var stateCommands = this.stateCommands;

      while (true) {
        if (stepper && i === stepper.nextBreakPoint) {
          stepper.breakIt(i, continueCallback);
          return i;
        }

        fnName = fnArray[i];

        if (this.clipper && (this.clipper.commandList.length != 0 || !stateCommands[fnName])) {
          if (this.clipper.commandList.length == 0) {
            this.clipper.reset(this.getFullContextState());
            this.depAnalyzer.reset();
          }
          this.clipper.addCommand({ name: fnName, args: argsArray[i] });
        }
        
        try {
          if (fnName !== 'dependency') {
            this[fnName].apply(this, argsArray[i]);
          } else {
            var deps = argsArray[i];
            for (var n = 0, nn = deps.length; n < nn; n++) {
              var depObjId = deps[n];
              var common = depObjId.substring(0, 2) == 'g_';

              // If the promise isn't resolved yet, add the continueCallback
              // to the promise and bail out.
              if (!common && !objs.isResolved(depObjId)) {
                objs.get(depObjId, continueCallback);
                return i;
              }
              if (common && !commonObjs.isResolved(depObjId)) {
                commonObjs.get(depObjId, continueCallback);
                return i;
              }
            }
          }
        } finally {
          if (this.clipper && (fnName in termCommands)) {
            // Treat form XObject as a whole
            if (this.current.paintFormXObjectDepth == 0) {
              this.recordObject(termCommands[fnName], operatorList.transparency);
              this.clipper.reset(null);
              this.depAnalyzer.reset();
            }
          }
        }
        
        i++;

        // If the entire operatorList was executed, stop as were done.
        if (i == argsArrayLen) {
          return i;
        }

        // If the execution took longer then a certain amount of time, shedule
        // to continue exeution after a short delay.
        // However, this is only possible if a 'continueCallback' is passed in.
        if (continueCallback && slowCommands[fnName] && Date.now() > endTime) {
          setTimeout(continueCallback, 0);
          return i;
        }

        // If the operatorList isn't executed completely yet OR the execution
        // time was short enough, do another execution round.
      }
    },

    endDrawing: function CanvasGraphics_endDrawing() {
      this.ctx.restore();
      CachedCanvases.clear();

      if (this.textLayer) {
        this.textLayer.endLayout();
      }
      if (this.bbLayer) {
        this.bbLayer.endLayout();
      }
      if (this.imageLayer) {
        this.imageLayer.endLayout();
      }
    },

    // Graphics state
    setLineWidth: function CanvasGraphics_setLineWidth(width) {
      this.current.lineWidth = width;
      this.ctx.lineWidth = width;
    },
    setLineCap: function CanvasGraphics_setLineCap(style) {
      this.ctx.lineCap = LINE_CAP_STYLES[style];
    },
    setLineJoin: function CanvasGraphics_setLineJoin(style) {
      this.ctx.lineJoin = LINE_JOIN_STYLES[style];
    },
    setMiterLimit: function CanvasGraphics_setMiterLimit(limit) {
      this.ctx.miterLimit = limit;
    },
    setDash: function CanvasGraphics_setDash(dashArray, dashPhase) {
      var ctx = this.ctx;
      if ('setLineDash' in ctx) {
        ctx.setLineDash(dashArray);
        ctx.lineDashOffset = dashPhase;
      } else {
        ctx.mozDash = dashArray;
        ctx.mozDashOffset = dashPhase;
      }
    },
    setRenderingIntent: function CanvasGraphics_setRenderingIntent(intent) {
      // Maybe if we one day fully support color spaces this will be important
      // for now we can ignore.
      // TODO set rendering intent?
    },
    setFlatness: function CanvasGraphics_setFlatness(flatness) {
      // There's no way to control this with canvas, but we can safely ignore.
      // TODO set flatness?
    },
    setGState: function CanvasGraphics_setGState(states) {
      for (var i = 0, ii = states.length; i < ii; i++) {
        var state = states[i];
        var key = state[0];
        var value = state[1];

        switch (key) {
          case 'LW':
            this.setLineWidth(value);
            break;
          case 'LC':
            this.setLineCap(value);
            break;
          case 'LJ':
            this.setLineJoin(value);
            break;
          case 'ML':
            this.setMiterLimit(value);
            break;
          case 'D':
            this.setDash(value[0], value[1]);
            break;
          case 'RI':
            this.setRenderingIntent(value);
            break;
          case 'FL':
            this.setFlatness(value);
            break;
          case 'Font':
            this.setFont(state[1], state[2]);
            break;
          case 'CA':
            this.current.strokeAlpha = state[1];
            break;
          case 'ca':
            this.current.fillAlpha = state[1];
            this.ctx.globalAlpha = state[1];
            break;
          case 'BM':
            if (value && value.name && (value.name !== 'Normal')) {
              var mode = value.name.replace(/([A-Z])/g,
                function(c) {
                  return '-' + c.toLowerCase();
                }
              ).substring(1);
              this.ctx.globalCompositeOperation = mode;
              if (this.ctx.globalCompositeOperation !== mode) {
                warn('globalCompositeOperation "' + mode +
                     '" is not supported');
              }
            } else {
              this.ctx.globalCompositeOperation = 'source-over';
            }
            break;
        }
      }
    },
    save: function CanvasGraphics_save() {
      this.ctx.save();
      var old = this.current;
      this.stateStack.push(old);
      this.current = old.clone();
      if (this.clipper)
        this.clipper.onSave();
    },
    restore: function CanvasGraphics_restore() {
      var prev = this.stateStack.pop();
      if (prev) {
        this.current = prev;
        this.ctx.restore();
      }
      if (this.clipper)
        this.clipper.onRestore(this.getFullContextState());
    },
    transform: function CanvasGraphics_transform(a, b, c, d, e, f) {
      this.ctx.transform(a, b, c, d, e, f);
    },

    // Path
    moveTo: function CanvasGraphics_moveTo(x, y) {
      this.ctx.moveTo(x, y);
      this.current.setCurrentPoint(x, y);
    },
    lineTo: function CanvasGraphics_lineTo(x, y) {
      var current = this.current;
      if (this.clipper) {
        var transform = this.ctx.mozCurrentTransform;
        var clipper = this.clipper;
        clipper.extendPoint({ x: current.x, y: current.y }, transform);
        clipper.extendPoint({ x: x, y: y }, transform);
      }
      this.ctx.lineTo(x, y);
      current.setCurrentPoint(x, y);
    },
    curveTo: function CanvasGraphics_curveTo(x1, y1, x2, y2, x3, y3) {
      var current = this.current;
      if (this.clipper) {
        // TODO: calc using real BBs, currently only an approximation
        var transform = this.ctx.mozCurrentTransform;
        var clipper = this.clipper;
        clipper.extendPoint({ x: current.x, y: current.y }, transform);
        clipper.extendPoint({ x: x1, y: y1 }, transform);
        clipper.extendPoint({ x: x2, y: y2 }, transform);
        clipper.extendPoint({ x: x3, y: y3 }, transform);
      }
      this.ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
      current.setCurrentPoint(x3, y3);
    },
    curveTo2: function CanvasGraphics_curveTo2(x2, y2, x3, y3) {
      var current = this.current;
      if (this.clipper) {
        // TODO: calc using real BBs, currently only an approximation
        var transform = this.ctx.mozCurrentTransform;
        var clipper = this.clipper;
        clipper.extendPoint({ x: current.x, y: current.y }, transform);
        clipper.extendPoint({ x: x2, y: y2 }, transform);
        clipper.extendPoint({ x: x3, y: y3 }, transform);
      }
      this.ctx.bezierCurveTo(current.x, current.y, x2, y2, x3, y3);
      current.setCurrentPoint(x3, y3);
    },
    curveTo3: function CanvasGraphics_curveTo3(x1, y1, x3, y3) {
      var current = this.current;
      if (this.clipper) {
        // TODO: calc using real BBs, currently only an approximation
        var transform = this.ctx.mozCurrentTransform;
        var clipper = this.clipper;
        clipper.extendPoint({ x: current.x, y: current.y }, transform);
        clipper.extendPoint({ x: x1, y: y1 }, transform);
        clipper.extendPoint({ x: x3, y: y3 }, transform);
      }
      this.curveTo(x1, y1, x3, y3, x3, y3);
      current.setCurrentPoint(x3, y3);
    },
    closePath: function CanvasGraphics_closePath() {
      this.ctx.closePath();
    },
    rectangle: function CanvasGraphics_rectangle(x, y, width, height) {
      if (this.clipper) {
        var transform = this.ctx.mozCurrentTransform;
        var clipper = this.clipper;
        clipper.extendPoint({ x: x, y: y }, transform);
        clipper.extendPoint({ x: x + width, y: y + height }, transform);
      }
      this.ctx.rect(x, y, width, height);
    },
    stroke: function CanvasGraphics_stroke(consumePath) {
      consumePath = typeof consumePath !== 'undefined' ? consumePath : true;
      var ctx = this.ctx;
      var strokeColor = this.current.strokeColor;
      if (this.current.lineWidth === 0)
        ctx.lineWidth = this.getSinglePixelWidth();
      // For stroke we want to temporarily change the global alpha to the
      // stroking alpha.
      ctx.globalAlpha = this.current.strokeAlpha;
      if (strokeColor && strokeColor.hasOwnProperty('type') &&
          strokeColor.type === 'Pattern') {
        // for patterns, we transform to pattern space, calculate
        // the pattern, call stroke, and restore to user space
        ctx.save();
        ctx.strokeStyle = strokeColor.getPattern(ctx, this.depAnalyzer);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
      if (consumePath)
        this.consumePath();
      // Restore the global alpha to the fill alpha
      ctx.globalAlpha = this.current.fillAlpha;
    },
    closeStroke: function CanvasGraphics_closeStroke() {
      this.closePath();
      this.stroke();
    },
    fill: function CanvasGraphics_fill(consumePath) {
      consumePath = typeof consumePath !== 'undefined' ? consumePath : true;
      var ctx = this.ctx;
      var fillColor = this.current.fillColor;
      var needRestore = false;

      if (fillColor && fillColor.hasOwnProperty('type') &&
          fillColor.type === 'Pattern') {
        ctx.save();
        ctx.fillStyle = fillColor.getPattern(ctx, this.depAnalyzer);
        needRestore = true;
      }

      if (this.pendingEOFill) {
        if ('mozFillRule' in this.ctx) {
          this.ctx.mozFillRule = 'evenodd';
          this.ctx.fill();
          this.ctx.mozFillRule = 'nonzero';
        } else {
          try {
            this.ctx.fill('evenodd');
          } catch (ex) {
            // shouldn't really happen, but browsers might think differently
            this.ctx.fill();
          }
        }
        this.pendingEOFill = false;
      } else {
        this.ctx.fill();
      }

      if (needRestore) {
        ctx.restore();
      }
      if (consumePath) {
        this.consumePath();
      }
    },
    eoFill: function CanvasGraphics_eoFill() {
      this.pendingEOFill = true;
      this.fill();
    },
    fillStroke: function CanvasGraphics_fillStroke() {
      this.fill(false);
      this.stroke(false);

      this.consumePath();
    },
    eoFillStroke: function CanvasGraphics_eoFillStroke() {
      this.pendingEOFill = true;
      this.fillStroke();
    },
    closeFillStroke: function CanvasGraphics_closeFillStroke() {
      this.closePath();
      this.fillStroke();
    },
    closeEOFillStroke: function CanvasGraphics_closeEOFillStroke() {
      this.pendingEOFill = true;
      this.closePath();
      this.fillStroke();
    },
    endPath: function CanvasGraphics_endPath() {
      this.consumePath();
    },

    // Clipping
    clip: function CanvasGraphics_clip() {
      this.pendingClip = NORMAL_CLIP;
      if (this.clipper && this.current.paintFormXObjectDepth == 0)
        this.clipper.clip();
    },
    eoClip: function CanvasGraphics_eoClip() {
      this.pendingClip = EO_CLIP;
      if (this.clipper && this.current.paintFormXObjectDepth == 0)
        this.clipper.clip();
    },

    // Text
    beginText: function CanvasGraphics_beginText() {
      this.current.textMatrix = IDENTITY_MATRIX;
      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;
    },
    endText: function CanvasGraphics_endText() {
      if (!('pendingTextPaths' in this)) {
        this.ctx.beginPath();
        return;
      }
      var paths = this.pendingTextPaths;
      var ctx = this.ctx;

      ctx.save();
      ctx.beginPath();
      for (var i = 0; i < paths.length; i++) {
        var path = paths[i];
        ctx.setTransform.apply(ctx, path.transform);
        ctx.translate(path.x, path.y);
        path.addToPath(ctx, path.fontSize);
      }
      ctx.restore();
      ctx.clip();
      ctx.beginPath();
      delete this.pendingTextPaths;
    },
    setCharSpacing: function CanvasGraphics_setCharSpacing(spacing) {
      this.current.charSpacing = spacing;
    },
    setWordSpacing: function CanvasGraphics_setWordSpacing(spacing) {
      this.current.wordSpacing = spacing;
    },
    setHScale: function CanvasGraphics_setHScale(scale) {
      this.current.textHScale = scale / 100;
    },
    setLeading: function CanvasGraphics_setLeading(leading) {
      this.current.leading = -leading;
    },
    setFont: function CanvasGraphics_setFont(fontRefName, size) {
      var fontObj = this.commonObjs.get(fontRefName);
      var current = this.current;

      if (!fontObj)
        error('Can\'t find font for ' + fontRefName);

      current.fontMatrix = fontObj.fontMatrix ? fontObj.fontMatrix :
                                                FONT_IDENTITY_MATRIX;

      // A valid matrix needs all main diagonal elements to be non-zero
      // This also ensures we bypass FF bugzilla bug #719844.
      if (current.fontMatrix[0] === 0 ||
          current.fontMatrix[3] === 0) {
        warn('Invalid font matrix for font ' + fontRefName);
      }

      // The spec for Tf (setFont) says that 'size' specifies the font 'scale',
      // and in some docs this can be negative (inverted x-y axes).
      if (size < 0) {
        size = -size;
        current.fontDirection = -1;
      } else {
        current.fontDirection = 1;
      }

      this.current.font = fontObj;
      this.current.fontRefName = fontRefName;
      this.current.fontSize = size;
      
      if (fontObj.coded)
        return; // we don't need ctx.font for Type3 fonts

      var name = fontObj.loadedName || 'sans-serif';
      var bold = fontObj.black ? (fontObj.bold ? 'bolder' : 'bold') :
                                 (fontObj.bold ? 'bold' : 'normal');

      var italic = fontObj.italic ? 'italic' : 'normal';
      var typeface = '"' + name + '", ' + fontObj.fallbackName;

      // Some font backends cannot handle fonts below certain size.
      // Keeping the font at minimal size and using the fontSizeScale to change
      // the current transformation matrix before the fillText/strokeText.
      // See https://bugzilla.mozilla.org/show_bug.cgi?id=726227
      var browserFontSize = size >= MIN_FONT_SIZE ? size : MIN_FONT_SIZE;
      this.current.fontSizeScale = browserFontSize != MIN_FONT_SIZE ? 1.0 :
                                   size / MIN_FONT_SIZE;

      var rule = italic + ' ' + bold + ' ' + browserFontSize + 'px ' + typeface;
      this.ctx.font = rule;
    },
    setTextRenderingMode: function CanvasGraphics_setTextRenderingMode(mode) {
      this.current.textRenderingMode = mode;
    },
    setTextRise: function CanvasGraphics_setTextRise(rise) {
      this.current.textRise = rise;
    },
    moveText: function CanvasGraphics_moveText(x, y) {
      this.current.x = this.current.lineX += x;
      this.current.y = this.current.lineY += y;
    },
    setLeadingMoveText: function CanvasGraphics_setLeadingMoveText(x, y) {
      this.setLeading(-y);
      this.moveText(x, y);
    },
    setTextMatrix: function CanvasGraphics_setTextMatrix(a, b, c, d, e, f) {
      this.current.textMatrix = [a, b, c, d, e, f];

      this.current.x = this.current.lineX = 0;
      this.current.y = this.current.lineY = 0;
    },
    nextLine: function CanvasGraphics_nextLine() {
      this.moveText(0, this.current.leading);
    },
    applyTextTransforms: function CanvasGraphics_applyTextTransforms() {
      var ctx = this.ctx;
      var current = this.current;
      ctx.transform.apply(ctx, current.textMatrix);
      ctx.translate(current.x, current.y + current.textRise);
      if (current.fontDirection > 0) {
        ctx.scale(current.textHScale, -1);
      } else {
        ctx.scale(-current.textHScale, 1);
      }
    },
    createTextGeometry: function CanvasGraphics_createTextGeometry() {
      var geometry = {};
      var ctx = this.ctx;
      var font = this.current.font;
      var ctxMatrix = ctx.mozCurrentTransform;
      var a = ctxMatrix[0], b = ctxMatrix[1], c = ctxMatrix[2];
      var d = ctxMatrix[3], e = ctxMatrix[4], f = ctxMatrix[5];
      var sx = (a >= 0) ?
          Math.sqrt((a * a) + (b * b)) : -Math.sqrt((a * a) + (b * b));
      var sy = (d >= 0) ?
          Math.sqrt((c * c) + (d * d)) : -Math.sqrt((c * c) + (d * d));
      var angle = Math.atan2(b, a);
      var x = e;
      var y = f;
      geometry.x = x;
      geometry.y = y;
      geometry.hScale = sx;
      geometry.vScale = sy;
      geometry.angle = angle;
      geometry.spaceWidth = font.spaceWidth;
      geometry.fontName = font.loadedName;
      geometry.fontFamily = font.fallbackName;
      geometry.fontSize = this.current.fontSize;
      return geometry;
    },

    paintChar: function (character, x, y) {
      var ctx = this.ctx;
      var current = this.current;
      var font = current.font;
      var fontSize = current.fontSize / current.fontSizeScale;
      var textRenderingMode = current.textRenderingMode;
      var fillStrokeMode = textRenderingMode &
        TextRenderingMode.FILL_STROKE_MASK;
      var isAddToPathSet = !!(textRenderingMode &
        TextRenderingMode.ADD_TO_PATH_FLAG);

      var addToPath;
      if (font.disableFontFace || isAddToPathSet) {
        addToPath = font.renderer.getPathGenerator(character);
      }

      if (font.disableFontFace) {
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        addToPath(ctx, fontSize);
        if (fillStrokeMode === TextRenderingMode.FILL ||
            fillStrokeMode === TextRenderingMode.FILL_STROKE) {
          ctx.fill();
        }
        if (fillStrokeMode === TextRenderingMode.STROKE ||
            fillStrokeMode === TextRenderingMode.FILL_STROKE) {
          ctx.stroke();
        }
        ctx.restore();
      } else {
        if (fillStrokeMode === TextRenderingMode.FILL ||
            fillStrokeMode === TextRenderingMode.FILL_STROKE) {
          ctx.fillText(character, x, y);
        }
        if (fillStrokeMode === TextRenderingMode.STROKE ||
            fillStrokeMode === TextRenderingMode.FILL_STROKE) {
          ctx.strokeText(character, x, y);
        }
      }

      if (isAddToPathSet) {
        var paths = this.pendingTextPaths || (this.pendingTextPaths = []);
        paths.push({
          transform: ctx.mozCurrentTransform,
          x: x,
          y: y,
          fontSize: fontSize,
          addToPath: addToPath
        });
      }
    },

    showText: function CanvasGraphics_showText(str, skipTextSelection, skipBBSelection) {
      var ctx = this.ctx;
      var current = this.current;
      var font = current.font;
      var glyphs = font.charsToGlyphs(str);
      var fontSize = current.fontSize;
      var fontSizeScale = current.fontSizeScale;
      var charSpacing = current.charSpacing;
      var wordSpacing = current.wordSpacing;
      var textHScale = current.textHScale * current.fontDirection;
      var fontMatrix = current.fontMatrix || FONT_IDENTITY_MATRIX;
      var glyphsLength = glyphs.length;
      var textLayer = this.textLayer;
      var bbLayer = this.bbLayer;
      var geom;
      var textSelection = textLayer && !skipTextSelection ? true : false;
      var bbSelection = !!(bbLayer && !skipBBSelection);
      var needGeometry = textSelection || bbSelection;
      var canvasWidth = 0.0;
      var canvasHeight = 0.0;
      var vertical = font.vertical;
      var defaultVMetrics = font.defaultVMetrics;

      // Type3 fonts - each glyph is a "mini-PDF"
      if (font.coded) {
        ctx.save();
        ctx.transform.apply(ctx, current.textMatrix);
        ctx.translate(current.x, current.y);

        ctx.scale(textHScale, 1);

        if (needGeometry) {
          this.save();
          ctx.scale(1, -1);
          geom = this.createTextGeometry();
          this.restore();
        }
        for (var i = 0; i < glyphsLength; ++i) {

          var glyph = glyphs[i];
          if (glyph === null) {
            // word break
            this.ctx.translate(wordSpacing, 0);
            current.x += wordSpacing * textHScale;
            continue;
          }

          this.processingType3 = glyph;
          this.save();
          ctx.scale(fontSize, fontSize);
          ctx.transform.apply(ctx, fontMatrix);
          this.executeOperatorList(glyph.operatorList);
          this.restore();

          var transformed = Util.applyTransform([glyph.width, 0], fontMatrix);
          var width = (transformed[0] * fontSize + charSpacing) *
                      current.fontDirection;

          ctx.translate(width, 0);
          current.x += width * textHScale;

          canvasWidth += width;
        }
        ctx.restore();
        this.processingType3 = null;
      } else {
        ctx.save();
        this.applyTextTransforms();

        var lineWidth = current.lineWidth;
        var a1 = current.textMatrix[0], b1 = current.textMatrix[1];
        var scale = Math.sqrt(a1 * a1 + b1 * b1);
        if (scale === 0 || lineWidth === 0)
          lineWidth = this.getSinglePixelWidth();
        else
          lineWidth /= scale;

        if (needGeometry)
          geom = this.createTextGeometry();

        if (fontSizeScale != 1.0) {
          ctx.scale(fontSizeScale, fontSizeScale);
          lineWidth /= fontSizeScale;
        }

        ctx.lineWidth = lineWidth;

        var x = 0;
        for (var i = 0; i < glyphsLength; ++i) {
          var glyph = glyphs[i];
          if (glyph === null) {
            // word break
            x += current.fontDirection * wordSpacing;
            continue;
          }

          var restoreNeeded = false;
          var character = glyph.fontChar;
          var vmetric = glyph.vmetric || defaultVMetrics;
          if (vertical) {
            var vx = glyph.vmetric ? vmetric[1] : glyph.width * 0.5;
            vx = -vx * fontSize * current.fontMatrix[0];
            var vy = vmetric[2] * fontSize * current.fontMatrix[0];
          }
          var width = vmetric ? -vmetric[0] : glyph.width;
          var charWidth = width * fontSize * current.fontMatrix[0] +
                          charSpacing * current.fontDirection;
          var accent = glyph.accent;

          var scaledX, scaledY, scaledAccentX, scaledAccentY;
          if (!glyph.disabled) {
            if (vertical) {
              scaledX = vx / fontSizeScale;
              scaledY = (x + vy) / fontSizeScale;
            } else {
              scaledX = x / fontSizeScale;
              scaledY = 0;
            }

            if (font.remeasure && width > 0) {
              // some standard fonts may not have the exact width, trying to
              // rescale per character
              var measuredWidth = ctx.measureText(character).width * 1000 /
                current.fontSize * current.fontSizeScale;
              var characterScaleX = width / measuredWidth;
              restoreNeeded = true;
              ctx.save();
              ctx.scale(characterScaleX, 1);
              scaledX /= characterScaleX;
              if (accent) {
                scaledAccentX /= characterScaleX;
              }
            }

            this.paintChar(character, scaledX, scaledY);
            if (accent) {
              scaledAccentX = scaledX + accent.offset.x / fontSizeScale;
              scaledAccentY = scaledY - accent.offset.y / fontSizeScale;
              this.paintChar(accent.fontChar, scaledAccentX, scaledAccentY);
            }
          }

          x += charWidth;

          canvasWidth += charWidth;

          if (restoreNeeded) {
            ctx.restore();
          }
        }
        if (vertical) {
          current.y -= x * textHScale;
        } else {
          current.x += x * textHScale;
        }
        ctx.restore();
      }

      var divHeight = Util.measureText(str, false, this.ctx.font, this.current.fontSize)[1];
      if (needGeometry) {
        geom.canvasWidth = canvasWidth;
        geom.divHeight = divHeight;
        if (vertical) {
          var vmetric = font.defaultVMetrics;
          geom.x += vmetric[1] * fontSize * current.fontMatrix[0] /
                    fontSizeScale * geom.hScale;
          geom.y += vmetric[2] * fontSize * current.fontMatrix[0] /
                    fontSizeScale * geom.vScale;
        }
        if (textSelection)
          this.textLayer.appendText(geom);
        if (bbSelection) {
          this.bbLayer.appendBoundingBox(BoundingBox.fromGeometry(geom), {
            type: BoundingBoxType.TEXT,
            textContent: null, // we'll set it later through setTextContent
            vertical: vertical,
            hide: false
          });
          if (this.clipper) {
            this.clipper.extendBoundingBox(BoundingBox.fromGeometry(geom));
          }
        }
      }
      if (this.depAnalyzer)
        this.depAnalyzer.addFontDependency(this.current.fontRefName);

      return { width: canvasWidth, height: divHeight };
    },
    showSpacedText: function CanvasGraphics_showSpacedText(arr) {
      var ctx = this.ctx;
      var current = this.current;
      var font = current.font;
      var fontSize = current.fontSize;
      // TJ array's number is independent from fontMatrix
      var textHScale = current.textHScale * 0.001 * current.fontDirection;
      var arrLength = arr.length;
      var textLayer = this.textLayer;
      var bbLayer = this.bbLayer;
      var geom;
      var canvasWidth = 0.0;
      var divHeight = 0.0;
      var textSelection = textLayer ? true : false;
      var bbSelection = !!bbLayer;
      var needGeometry = textSelection || bbSelection;
      var vertical = font.vertical;
      var spacingAccumulator = 0;

      if (needGeometry) {
        ctx.save();
        this.applyTextTransforms();
        geom = this.createTextGeometry();
        ctx.restore();
      }
      
      for (var i = 0; i < arrLength; ++i) {
        var e = arr[i];
        if (isNum(e)) {
          var spacingLength = -e * fontSize * textHScale;
          if (vertical) {
            current.y += spacingLength;
          } else {
            current.x += spacingLength;
          }

          if (needGeometry)
            spacingAccumulator += spacingLength;
        } else if (isString(e)) {
          var shownCanvasSize = this.showText(e, true, true);

          if (needGeometry) {
            canvasWidth += spacingAccumulator + shownCanvasSize.width;
            divHeight = Math.max(divHeight, shownCanvasSize.height);
            spacingAccumulator = 0;
          }
        } else {
          error('TJ array element ' + e + ' is not string or num');
        }
      }

      if (needGeometry) {
        geom.canvasWidth = canvasWidth;
        geom.divHeight = divHeight;
        if (vertical) {
          var fontSizeScale = current.fontSizeScale;
          var vmetric = font.defaultVMetrics;
          geom.x += vmetric[1] * fontSize * current.fontMatrix[0] /
                    fontSizeScale * geom.hScale;
          geom.y += vmetric[2] * fontSize * current.fontMatrix[0] /
                    fontSizeScale * geom.vScale;
        }
        if (textSelection)
          this.textLayer.appendText(geom);
        if (bbSelection) {
          this.bbLayer.appendBoundingBox(BoundingBox.fromGeometry(geom), {
            type: BoundingBoxType.TEXT,
            textContent: null, // we'll set it later through setTextContent
            vertical: vertical,
            hide: false
          });
          if (this.clipper) {
            this.clipper.extendBoundingBox(BoundingBox.fromGeometry(geom));
          }
        }
      }
      if (this.depAnalyzer)
        this.depAnalyzer.addFontDependency(this.current.fontRefName);
    },
    nextLineShowText: function CanvasGraphics_nextLineShowText(text) {
      this.nextLine();
      this.showText(text);
    },
    nextLineSetSpacingShowText:
      function CanvasGraphics_nextLineSetSpacingShowText(wordSpacing,
                                                         charSpacing,
                                                         text) {
      this.setWordSpacing(wordSpacing);
      this.setCharSpacing(charSpacing);
      this.nextLineShowText(text);
    },

    // Type3 fonts
    setCharWidth: function CanvasGraphics_setCharWidth(xWidth, yWidth) {
      // We can safely ignore this since the width should be the same
      // as the width in the Widths array.
    },
    setCharWidthAndBounds: function CanvasGraphics_setCharWidthAndBounds(xWidth,
                                                                        yWidth,
                                                                        llx,
                                                                        lly,
                                                                        urx,
                                                                        ury) {
      // TODO According to the spec we're also suppose to ignore any operators
      // that set color or include images while processing this type3 font.
      this.rectangle(llx, lly, urx - llx, ury - lly);
      this.clip();
      this.endPath();
    },

    // Color
    setStrokeColorSpace: function CanvasGraphics_setStrokeColorSpace(raw) {
      this.current.strokeColorSpace = ColorSpace.fromIR(raw);
    },
    setFillColorSpace: function CanvasGraphics_setFillColorSpace(raw) {
      this.current.fillColorSpace = ColorSpace.fromIR(raw);
    },
    setStrokeColor: function CanvasGraphics_setStrokeColor(/*...*/) {
      var cs = this.current.strokeColorSpace;
      var rgbColor = cs.getRgb(arguments, 0);
      var color = Util.makeCssRgb(rgbColor);
      this.ctx.strokeStyle = color;
      this.current.strokeColor = color;
    },
    getColorN_Pattern: function CanvasGraphics_getColorN_Pattern(IR, cs) {
      if (IR[0] == 'TilingPattern') {
        var args = IR[1];
        var base = cs.base;
        var color;
        if (base) {
          var baseComps = base.numComps;

          color = base.getRgb(args, 0);
        }
        var pattern = new TilingPattern(IR, color, this.ctx, this.objs,
                                        this.commonObjs);
      } else if (IR[0] == 'RadialAxial' || IR[0] == 'Dummy') {
        var pattern = Pattern.shadingFromIR(IR);
      } else {
        error('Unkown IR type ' + IR[0]);
      }
      return pattern;
    },
    setStrokeColorN: function CanvasGraphics_setStrokeColorN(/*...*/) {
      var cs = this.current.strokeColorSpace;

      if (cs.name == 'Pattern') {
        this.current.strokeColor = this.getColorN_Pattern(arguments, cs);
      } else {
        this.setStrokeColor.apply(this, arguments);
      }
    },
    setFillColor: function CanvasGraphics_setFillColor(/*...*/) {
      var cs = this.current.fillColorSpace;
      var rgbColor = cs.getRgb(arguments, 0);
      var color = Util.makeCssRgb(rgbColor);
      this.ctx.fillStyle = color;
      this.current.fillColor = color;
    },
    setFillColorN: function CanvasGraphics_setFillColorN(/*...*/) {
      var cs = this.current.fillColorSpace;

      if (cs.name == 'Pattern') {
        this.current.fillColor = this.getColorN_Pattern(arguments, cs);
      } else {
        this.setFillColor.apply(this, arguments);
      }
    },
    setStrokeGray: function CanvasGraphics_setStrokeGray(gray) {
      if (!(this.current.strokeColorSpace instanceof DeviceGrayCS))
        this.current.strokeColorSpace = new DeviceGrayCS();

      var rgbColor = this.current.strokeColorSpace.getRgb(arguments, 0);
      var color = Util.makeCssRgb(rgbColor);
      this.ctx.strokeStyle = color;
      this.current.strokeColor = color;
    },
    setFillGray: function CanvasGraphics_setFillGray(gray) {
      if (!(this.current.fillColorSpace instanceof DeviceGrayCS))
        this.current.fillColorSpace = new DeviceGrayCS();

      var rgbColor = this.current.fillColorSpace.getRgb(arguments, 0);
      var color = Util.makeCssRgb(rgbColor);
      this.ctx.fillStyle = color;
      this.current.fillColor = color;
    },
    setStrokeRGBColor: function CanvasGraphics_setStrokeRGBColor(r, g, b) {
      if (!(this.current.strokeColorSpace instanceof DeviceRgbCS))
        this.current.strokeColorSpace = new DeviceRgbCS();

      var rgbColor = this.current.strokeColorSpace.getRgb(arguments, 0);
      var color = Util.makeCssRgb(rgbColor);
      this.ctx.strokeStyle = color;
      this.current.strokeColor = color;
    },
    setFillRGBColor: function CanvasGraphics_setFillRGBColor(r, g, b) {
      if (!(this.current.fillColorSpace instanceof DeviceRgbCS))
        this.current.fillColorSpace = new DeviceRgbCS();

      var rgbColor = this.current.fillColorSpace.getRgb(arguments, 0);
      var color = Util.makeCssRgb(rgbColor);
      this.ctx.fillStyle = color;
      this.current.fillColor = color;
    },
    setStrokeCMYKColor: function CanvasGraphics_setStrokeCMYKColor(c, m, y, k) {
      if (!(this.current.strokeColorSpace instanceof DeviceCmykCS))
        this.current.strokeColorSpace = new DeviceCmykCS();

      var color = Util.makeCssCmyk(arguments);
      this.ctx.strokeStyle = color;
      this.current.strokeColor = color;
    },
    setFillCMYKColor: function CanvasGraphics_setFillCMYKColor(c, m, y, k) {
      if (!(this.current.fillColorSpace instanceof DeviceCmykCS))
        this.current.fillColorSpace = new DeviceCmykCS();

      var color = Util.makeCssCmyk(arguments);
      this.ctx.fillStyle = color;
      this.current.fillColor = color;
    },

    shadingFill: function CanvasGraphics_shadingFill(patternIR) {
      var ctx = this.ctx;

      this.save();
      var pattern = Pattern.shadingFromIR(patternIR);
      ctx.fillStyle = pattern.getPattern(ctx, this.depAnalyzer);

      var inv = ctx.mozCurrentTransformInverse;
      if (inv) {
        var canvas = ctx.canvas;
        var width = canvas.width;
        var height = canvas.height;

        var bl = Util.applyTransform([0, 0], inv);
        var br = Util.applyTransform([0, height], inv);
        var ul = Util.applyTransform([width, 0], inv);
        var ur = Util.applyTransform([width, height], inv);

        var x0 = Math.min(bl[0], br[0], ul[0], ur[0]);
        var y0 = Math.min(bl[1], br[1], ul[1], ur[1]);
        var x1 = Math.max(bl[0], br[0], ul[0], ur[0]);
        var y1 = Math.max(bl[1], br[1], ul[1], ur[1]);

        this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else {
        // HACK to draw the gradient onto an infinite rectangle.
        // PDF gradients are drawn across the entire image while
        // Canvas only allows gradients to be drawn in a rectangle
        // The following bug should allow us to remove this.
        // https://bugzilla.mozilla.org/show_bug.cgi?id=664884

        this.ctx.fillRect(-1e10, -1e10, 2e10, 2e10);
      }

      this.restore();
    },

    // Images
    beginInlineImage: function CanvasGraphics_beginInlineImage() {
      error('Should not call beginInlineImage');
    },
    beginImageData: function CanvasGraphics_beginImageData() {
      error('Should not call beginImageData');
    },

    paintFormXObjectBegin: function CanvasGraphics_paintFormXObjectBegin(matrix,
                                                                        bbox) {
      this.save();

      if (matrix && isArray(matrix) && 6 == matrix.length)
        this.transform.apply(this, matrix);

      if (bbox && isArray(bbox) && 4 == bbox.length) {
        var width = bbox[2] - bbox[0];
        var height = bbox[3] - bbox[1];
        this.rectangle(bbox[0], bbox[1], width, height);
        this.clip();
        this.endPath();
      }
      
      this.current.paintFormXObjectDepth++;
    },

    paintFormXObjectEnd: function CanvasGraphics_paintFormXObjectEnd() {
      var depth = this.current.paintFormXObjectDepth;
      do {
        this.restore();
        // some pdf don't close all restores inside object
        // closing those for them
      } while (this.current.paintFormXObjectDepth >= depth);
    },

    beginGroup: function CanvasGraphics_beginGroup(group) {
      this.save();
      var currentCtx = this.ctx;
      // TODO non-isolated groups - according to Rik at adobe non-isolated
      // group results aren't usually that different and they even have tools
      // that ignore this setting. Notes from Rik on implmenting:
      // - When you encounter an transparency group, create a new canvas with
      // the dimensions of the bbox
      // - copy the content from the previous canvas to the new canvas
      // - draw as usual
      // - remove the backdrop alpha:
      // alphaNew = 1 - (1 - alpha)/(1 - alphaBackdrop) with 'alpha' the alpha
      // value of your transparency group and 'alphaBackdrop' the alpha of the
      // backdrop
      // - remove background color:
      // colorNew = color - alphaNew *colorBackdrop /(1 - alphaNew)
      if (!group.isolated) {
        info('TODO: Support non-isolated groups.');
      }

      // TODO knockout - supposedly possible with the clever use of compositing
      // modes.
      if (group.knockout) {
        TODO('Support knockout groups.');
      }

      var currentTransform = currentCtx.mozCurrentTransform;
      if (group.matrix) {
        currentCtx.transform.apply(currentCtx, group.matrix);
      }
      assert(group.bbox, 'Bounding box is required.');

      // Based on the current transform figure out how big the bounding box
      // will actually be.
      var bounds = Util.getAxialAlignedBoundingBox(
                    group.bbox,
                    currentCtx.mozCurrentTransform);
      // Use ceil in case we're between sizes so we don't create canvas that is
      // too small and make the canvas at least 1x1 pixels.
      var drawnWidth = Math.max(Math.ceil(bounds[2] - bounds[0]), 1);
      var drawnHeight = Math.max(Math.ceil(bounds[3] - bounds[1]), 1);

      var scratchCanvas = createScratchCanvas(drawnWidth, drawnHeight);
      var groupCtx = scratchCanvas.getContext('2d');
      addContextCurrentTransform(groupCtx);
      // Since we created a new canvas that is just the size of the bounding box
      // we have to translate the group ctx.
      var offsetX = bounds[0];
      var offsetY = bounds[1];
      groupCtx.translate(-offsetX, -offsetY);
      groupCtx.transform.apply(groupCtx, currentTransform);

      // Setup the current ctx so when the group is popped we draw it the right
      // location.
      currentCtx.setTransform(1, 0, 0, 1, 0, 0);
      currentCtx.translate(offsetX, offsetY);

      // The transparency group inherits all off the current graphics state
      // except the blend mode, soft mask, and alpha constants.
      copyCtxState(currentCtx, groupCtx);
      this.ctx = groupCtx;
      this.setGState([
        ['SMask', 'None'],
        ['BM', 'Normal'],
        ['ca', 1],
        ['CA', 1]
      ]);
      this.groupStack.push(currentCtx);
    },

    endGroup: function CanvasGraphics_endGroup(group) {
      var groupCtx = this.ctx;
      this.ctx = this.groupStack.pop();
      // Turn off image smoothing to avoid sub pixel interpolation which can
      // look kind of blurry for some pdfs.
      if ('imageSmoothingEnabled' in this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
      } else {
        this.ctx.mozImageSmoothingEnabled = false;
      }
      this.ctx.drawImage(groupCtx.canvas, 0, 0);
      this.restore();
    },

    beginAnnotations: function CanvasGraphics_beginAnnotations() {
      this.save();
      this.current = new CanvasExtraState();
    },

    endAnnotations: function CanvasGraphics_endAnnotations() {
      this.restore();
    },

    beginAnnotation: function CanvasGraphics_beginAnnotation(rect, transform,
                                                             matrix) {
      this.save();

      if (rect && isArray(rect) && 4 == rect.length) {
        var width = rect[2] - rect[0];
        var height = rect[3] - rect[1];
        this.rectangle(rect[0], rect[1], width, height);
        this.clip();
        this.endPath();
      }

      this.transform.apply(this, transform);
      this.transform.apply(this, matrix);
    },

    endAnnotation: function CanvasGraphics_endAnnotation() {
      this.restore();
    },

    paintJpegXObject: function CanvasGraphics_paintJpegXObject(objId, w, h) {
      var domImage = this.objs.get(objId);
      if (!domImage) {
        error('Dependent image isn\'t ready yet');
      }
      
      if (this.depAnalyzer)
        this.depAnalyzer.addImageDependency(objId);

      this.save();

      var ctx = this.ctx;
      // scale the image to the unit square
      ctx.scale(1 / w, -1 / h);

      ctx.drawImage(domImage, 0, 0, domImage.width, domImage.height,
                    0, -h, w, h);
      if (this.imageLayer || this.clipper) {
        var currentTransform = ctx.mozCurrentTransformInverse;
        var position = this.getCanvasPosition(0, 0);
        var size = { width: w / currentTransform[0], height: h / currentTransform[3] };
        if (this.imageLayer) {
          this.imageLayer.appendImage({
            objId: objId,
            left: position[0],
            top: position[1] - size.height,
            width: size.width,
            height: size.height
          });
        }
        if (this.clipper)
          this.clipper.extendBoundingBox(new BoundingBox(position[0], position[1] - size.height, size.width, size.height));
      }
      this.restore();
    },

    paintImageMaskXObject: function CanvasGraphics_paintImageMaskXObject(img) {
      var ctx = this.ctx;
      var width = img.width, height = img.height;

      var glyph = this.processingType3;

      if (COMPILE_TYPE3_GLYPHS && glyph && !('compiled' in glyph)) {
        var MAX_SIZE_TO_COMPILE = 1000;
        if (width <= MAX_SIZE_TO_COMPILE && height <= MAX_SIZE_TO_COMPILE) {
          glyph.compiled =
            compileType3Glyph({data: img.data, width: width, height: height});
        } else {
          glyph.compiled = null;
        }
      }

      if (glyph && glyph.compiled) {
        glyph.compiled(ctx);
        return;
      }

      var maskCanvas = CachedCanvases.getCanvas('maskCanvas', width, height);
      var maskCtx = maskCanvas.getContext('2d');
      maskCtx.save();

      putBinaryImageData(maskCtx, img);

      maskCtx.globalCompositeOperation = 'source-in';

      var fillColor = this.current.fillColor;
      maskCtx.fillStyle = (fillColor && fillColor.hasOwnProperty('type') &&
                          fillColor.type === 'Pattern') ?
                          fillColor.getPattern(maskCtx, this.depAnalyzer) : fillColor;
      maskCtx.fillRect(0, 0, width, height);

      maskCtx.restore();

      this.paintInlineImageXObject(maskCanvas);
    },

    paintImageMaskXObjectGroup:
      function CanvasGraphics_paintImageMaskXObjectGroup(images) {
      var ctx = this.ctx;

      for (var i = 0, ii = images.length; i < ii; i++) {
        var image = images[i];
        var width = image.width, height = image.height;

        var maskCanvas = CachedCanvases.getCanvas('maskCanvas', width, height);
        var maskCtx = maskCanvas.getContext('2d');
        maskCtx.save();

        putBinaryImageData(maskCtx, image);

        maskCtx.globalCompositeOperation = 'source-in';

        var fillColor = this.current.fillColor;
        maskCtx.fillStyle = (fillColor && fillColor.hasOwnProperty('type') &&
                            fillColor.type === 'Pattern') ?
                            fillColor.getPattern(maskCtx, this.depAnalyzer) : fillColor;
        maskCtx.fillRect(0, 0, width, height);

        maskCtx.restore();

        ctx.save();
        ctx.transform.apply(ctx, image.transform);
        ctx.scale(1, -1);
        ctx.drawImage(maskCanvas, 0, 0, width, height,
                      0, -1, 1, 1);
        ctx.restore();
      }
    },

    paintImageXObject: function CanvasGraphics_paintImageXObject(objId) {
      var imgData = this.objs.get(objId);
      if (!imgData)
        error('Dependent image isn\'t ready yet');
      
      if (this.depAnalyzer)
        this.depAnalyzer.addImageDependency(objId);
        
      this.paintInlineImageXObject(imgData);
    },

    paintInlineImageXObject:
      function CanvasGraphics_paintInlineImageXObject(imgData) {
      var width = imgData.width;
      var height = imgData.height;
      var ctx = this.ctx;

      this.save();
      // scale the image to the unit square
      ctx.scale(1 / width, -1 / height);

      var currentTransform = ctx.mozCurrentTransformInverse;
      var a = currentTransform[0], b = currentTransform[1];
      var widthScale = Math.max(Math.sqrt(a * a + b * b), 1);
      var c = currentTransform[2], d = currentTransform[3];
      var heightScale = Math.max(Math.sqrt(c * c + d * d), 1);

      var imgToPaint;
      if (imgData instanceof HTMLElement) {
        imgToPaint = imgData;
      } else {
        var tmpCanvas = CachedCanvases.getCanvas('inlineImage', width, height);
        var tmpCtx = tmpCanvas.getContext('2d');
        putBinaryImageData(tmpCtx, imgData);
        imgToPaint = tmpCanvas;
      }

      var paintWidth = width, paintHeight = height;
      var tmpCanvasId = 'prescale1';
      // Vertial or horizontal scaling shall not be more than 2 to not loose the
      // pixels during drawImage operation, painting on the temporary canvas(es)
      // that are twice smaller in size
      while ((widthScale > 2 && paintWidth > 1) ||
             (heightScale > 2 && paintHeight > 1)) {
        var newWidth = paintWidth, newHeight = paintHeight;
        if (widthScale > 2 && paintWidth > 1) {
          newWidth = Math.ceil(paintWidth / 2);
          widthScale /= paintWidth / newWidth;
        }
        if (heightScale > 2 && paintHeight > 1) {
          newHeight = Math.ceil(paintHeight / 2);
          heightScale /= paintHeight / newHeight;
        }
        var tmpCanvas = CachedCanvases.getCanvas(tmpCanvasId,
                                                 newWidth, newHeight);
        tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.clearRect(0, 0, newWidth, newHeight);
        tmpCtx.drawImage(imgToPaint, 0, 0, paintWidth, paintHeight,
                                     0, 0, newWidth, newHeight);
        imgToPaint = tmpCanvas;
        paintWidth = newWidth;
        paintHeight = newHeight;
        tmpCanvasId = tmpCanvasId === 'prescale1' ? 'prescale2' : 'prescale1';
      }
      ctx.drawImage(imgToPaint, 0, 0, paintWidth, paintHeight,
                                0, -height, width, height);

      if (this.imageLayer || this.clipper) {
        var position = this.getCanvasPosition(0, -height);
        if (this.imageLayer) {
          this.imageLayer.appendImage({
            imgData: imgData,
            left: position[0],
            top: position[1],
            width: width / currentTransform[0],
            height: height / currentTransform[3]
          });
        }
        if (this.clipper)
          this.clipper.extendBoundingBox(new BoundingBox(position[0], position[1], width / currentTransform[0], height / currentTransform[3]));
      }
      this.restore();
    },

    paintInlineImageXObjectGroup:
      function CanvasGraphics_paintInlineImageXObjectGroup(imgData, map) {
      var ctx = this.ctx;
      var w = imgData.width;
      var h = imgData.height;

      var tmpCanvas = CachedCanvases.getCanvas('inlineImage', w, h);
      var tmpCtx = tmpCanvas.getContext('2d');
      putBinaryImageData(tmpCtx, imgData);

      for (var i = 0, ii = map.length; i < ii; i++) {
        var entry = map[i];
        ctx.save();
        ctx.transform.apply(ctx, entry.transform);
        ctx.scale(1, -1);
        ctx.drawImage(tmpCanvas, entry.x, entry.y, entry.w, entry.h,
                      0, -1, 1, 1);
        if (this.imageLayer || this.clipper) {
          var position = this.getCanvasPosition(entry.x, entry.y);
          if (this.imageLayer) {
            this.imageLayer.appendImage({
              imgData: imgData,
              left: position[0],
              top: position[1],
              width: w,
              height: h
            });
          }
          if (this.clipper)
            this.clipper.extendBoundingBox(new BoundingBox(position[0], position[1], w, h));
        }
        ctx.restore();
      }
    },

    // Marked content

    markPoint: function CanvasGraphics_markPoint(tag) {
      // TODO Marked content.
    },
    markPointProps: function CanvasGraphics_markPointProps(tag, properties) {
      // TODO Marked content.
    },
    beginMarkedContent: function CanvasGraphics_beginMarkedContent(tag) {
      // TODO Marked content.
    },
    beginMarkedContentProps: function CanvasGraphics_beginMarkedContentProps(
                                        tag, properties) {
      // TODO Marked content.
    },
    endMarkedContent: function CanvasGraphics_endMarkedContent() {
      // TODO Marked content.
    },

    // Compatibility

    beginCompat: function CanvasGraphics_beginCompat() {
      // TODO ignore undefined operators (should we do that anyway?)
    },
    endCompat: function CanvasGraphics_endCompat() {
      // TODO stop ignoring undefined operators
    },

    // Helper functions

    consumePath: function CanvasGraphics_consumePath() {
      if (this.pendingClip) {
        if (this.pendingClip == EO_CLIP) {
          if ('mozFillRule' in this.ctx) {
            this.ctx.mozFillRule = 'evenodd';
            this.ctx.clip();
            this.ctx.mozFillRule = 'nonzero';
          } else {
            try {
              this.ctx.clip('evenodd');
            } catch (ex) {
              // shouldn't really happen, but browsers might think differently
              this.ctx.clip();
            }
          }
        } else {
          this.ctx.clip();
        }
        this.pendingClip = null;
      }
      this.ctx.beginPath();
    },
    getSinglePixelWidth: function CanvasGraphics_getSinglePixelWidth(scale) {
      var inverse = this.ctx.mozCurrentTransformInverse;
      // max of the current horizontal and vertical scale
      return Math.sqrt(Math.max(
        (inverse[0] * inverse[0] + inverse[1] * inverse[1]),
        (inverse[2] * inverse[2] + inverse[3] * inverse[3])));
    },
    getCanvasPosition: function CanvasGraphics_getCanvasPosition(x, y) {
        var transform = this.ctx.mozCurrentTransform;
        return [
          transform[0] * x + transform[2] * y + transform[4],
          transform[1] * x + transform[3] * y + transform[5]
        ];
    }
  };

  return CanvasGraphics;
})();


"use strict"

var BoundingBoxType = {
  TEXT: 1,
  IMAGE: 2,
  PRIMITIVE: 3,
  PRIMITIVE_TEXT: 4
};

function BoundingBox(left, top, width, height) {
  this.left = left;
  this.top = top;
  this.width = width;
  this.height = height;
}

BoundingBox.prototype = {
  get right() {
    return this.left + this.width;
  },
  get bottom() {
    return this.top + this.height;
  },
  clone: function() {
    return new BoundingBox(this.left, this.top, this.width, this.height);
  },
  intersect: function(bb) {
    var PORTION_THRESHOLD = 0.8;
    // compute the intersection area
    var iw = Math.max(0, Math.min(this.right, bb.right) - Math.max(this.left, bb.left));
    var ih = Math.max(0, Math.min(this.bottom, bb.bottom) - Math.max(this.top, bb.top));
    // intersection detection based on portion of intersection area
    var portion = iw * ih / (bb.width * bb.height);
    return portion >= PORTION_THRESHOLD;
  },
  extendPoint: function(pt) {
    if (pt.x < this.left) {
      this.width = this.right - pt.x;
      this.left = pt.x;
    } else if (pt.x > this.right)
      this.width = pt.x - this.left;
    
    if (pt.y < this.top) {
      this.height = this.bottom - pt.y;
      this.top = pt.y;
    } else if (pt.y > this.bottom)
      this.height = pt.y - this.top;
  },
  extendBoundingBox: function(bb) {
    this.extendPoint({ x: bb.left, y: bb.top });
    this.extendPoint({ x: bb.right, y: bb.bottom });
  },
  restrict: function(bb) {
    if (this.left < bb.left) {
      this.width -= bb.left - this.left;
      this.left = bb.left;
    }
    if (this.top < bb.top) {
      this.height -= bb.top - this.top;
      this.top = bb.top;
    }
    if (this.right > bb.right) {
      this.width -= this.right - bb.right;
    }
    if (this.bottom > bb.bottom) {
      this.height -= this.bottom - bb.bottom;
    }
  }
};

BoundingBox.fromGeometry = function(geom) {
  var fontHeight = geom.fontSize * Math.abs(geom.vScale);
  return new BoundingBox(
    /*left*/geom.x,
    /*top*/geom.y - fontHeight,
    /*width*/geom.canvasWidth * geom.hScale,
    /*height*/fontHeight);
};

BoundingBox.fromElement = function(element, bbLayerDiv) {
  var pos = { left: element.offsetLeft, top: element.offsetTop };
  pos = Utils.translatePosition(pos, element.offsetParent, bbLayerDiv);
  return new BoundingBox(pos.left, pos.top, element.offsetWidth, element.offsetHeight);
};

function BoundingBoxLayerBuilder(bbLayerDiv, pageIdx) {
  this._bbLayerFrag = document.createDocumentFragment();
  
  this.bbLayerDiv = bbLayerDiv;
  this.pageIdx = pageIdx;
  this.layoutDone = false;
  
  this.isSelecting = false;
  this.selectionBB = new BoundingBox(0, 0, 0, 0);
}

BoundingBoxLayerBuilder.isBBVisible = function(bb) {
  var MIN_BB_SELECTION_WIDTH = 4;
  var MIN_BB_SELECTION_HEIGHT = 4;
  var width = Math.abs(bb.width - 1) + 1;
  var height = Math.abs(bb.height - 1) + 1;
  return width >= MIN_BB_SELECTION_WIDTH && height >= MIN_BB_SELECTION_HEIGHT;
}

BoundingBoxLayerBuilder.prototype = {
  beginLayout: function() {
    this.bbDivs = [];
    this.bbs = [];
    this.bbContents = [];
  },
  
  endLayout: function() {
    this.layoutDone = true;
    this.insertDivContent();
  },
  
  renderLayer: function() {
    var bbDivs = this.bbDivs;
    var bbLayerDiv = this.bbLayerDiv;
    var bbLayerFrag = this._bbLayerFrag;
    
    // No point in rendering so many divs as it'd make the browser unusable
    // even after the divs are rendered
    var MAX_TEXT_DIVS_TO_RENDER = 100000;
    if (bbDivs.length > MAX_TEXT_DIVS_TO_RENDER)
      return;

    for (var i = 0, l = bbDivs.length; i < l; i++) {
      var bbDiv = bbDivs[i];
      var content = this.bbContents[parseInt(bbDiv.dataset.contentIdx)];
      if (content && content.type == BoundingBoxType.TEXT)
        bbDiv.dataset.text = content.textContent;
      bbLayerFrag.appendChild(bbDiv);
    }
    
    this.renderingDone = true;
    
    bbLayerDiv.appendChild(bbLayerFrag);
    
    // Add event listeners for bounding box layer selection
    bbLayerDiv.addEventListener("mousedown", this.onMouseDown.bind(this), false);
    bbLayerDiv.addEventListener("mouseup", this.onMouseUp.bind(this), false);
  },
  
  setupRenderLayoutTimer: function() {
    var RENDER_DELAY = 200; // in ms
    this._setupTimer(this.renderLayer, function() PDFView.lastScroll, RENDER_DELAY);
  },
  
  appendBoundingBox: function(bb, content) {
    if (!content.hide) {
      var bbDiv = document.createElement("div");
      
      bbDiv.dataset.pageIdx = this.pageIdx;
      bbDiv.dataset.contentIdx = this.bbContents.length;
      
      bbDiv.style.left = bb.left + "px";
      bbDiv.style.top = bb.top + "px";
      bbDiv.style.width = bb.width + "px";
      bbDiv.style.height = bb.height + "px";
      
      this.bbs.push(bb);
      this.bbDivs.push(bbDiv);
    }
    this.bbContents.push(content);
  },
  
  setTextContent: function(textContent) {
    this.textContent = textContent;
    this.insertDivContent();
  },
  
  insertDivContent: function() {
    // Only set the content of the divs once layout has finished, the content
    // for the divs is available and content is not yet set on the divs.
    if (!this.layoutDone || this.divContentDone || !this.textContent)
      return;

    this.divContentDone = true;

    var bbContents = this.bbContents;
    var bidiTexts = this.textContent.bidiTexts;

    // Assign text content from the textContent we just get
    for (var i = 0, j = 0, l = bidiTexts.length; i < l; i++) {
      var bidiText = bidiTexts[i];
      while (bbContents[j++].type != BoundingBoxType.TEXT);
      
      bbContents[j - 1].textContent = bidiText.str;
    }

    this.setupRenderLayoutTimer();
  },
  
  // Selection event handling
  onMouseDown: function(event) {
    // do not process clicks on the clip button, etc
    var target = event.target;
    while (target != this.bbLayerDiv) {
      if (target.classList && target.classList.contains("bypassSelection"))
        return;
      target = target.parentElement;
    }
    
    var initialBB = null;
    if (Utils.matchesSelector(event.target, ".bbLayer > div:not(.bbLayerSelection)")) {
      initialBB = BoundingBox.fromElement(event.target, this.bbLayerDiv);
    }
    
    // We wanna handle all subsequent mouse events on the layer div
    // It's not necessary to bubble everything up
    this.bbLayerDiv.setCapture(true);
    
    // If listener still bound, e.g. due to focus lost while selecting,
    // we should not try to initiate another selection gesture
    if (this._onMouseMoveBinded)
      return;
    
    this._onMouseMoveBinded = this.onMouseMove.bind(this);
    this.bbLayerDiv.addEventListener("mousemove", this._onMouseMoveBinded, false);
    
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionStart(pos, initialBB);
  },
  
  onMouseUp: function(event) {
    // do not handle when no event handler is bound
    if (!this._onMouseMoveBinded)
      return;

    this.onMouseMove(event);
    this.bbLayerDiv.removeEventListener("mousemove", this._onMouseMoveBinded,
    false);
    this._onMouseMoveBinded = null;
    
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionEnd(pos);
  },
  
  onMouseMove: function(event) {
    var pos = Utils.translatePosition({ left: event.pageX, top: event.pageY }, null, this.bbLayerDiv);
    this.onSelectionMove(pos);
  },
  
  onSelectionStart: function(pos, initialBB) {
    var selectionBB = this.selectionBB = new BoundingBox(pos.left, pos.top, 1, 1);
    this.initialBB = initialBB || selectionBB.clone();
    selectionBB = this.initialBB;
    
    // Create the div for displaying the selection
    var selectionDiv = this.selectionDiv || (this.selectionDiv = document.createElement("div"));
    selectionDiv.className = "bbLayerSelection bypassSelection";
    selectionDiv.style.left = selectionBB.left + "px";
    selectionDiv.style.top = selectionBB.top + "px";
    selectionDiv.style.width = selectionBB.width + "px";
    selectionDiv.style.height = selectionBB.height + "px";
    selectionDiv.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";
    this.bbLayerDiv.appendChild(selectionDiv);
    
    if (this._clipButton) {
      this._clipButton.style.visibility = "hidden";
    }
    
    this._lastSelectionAction = Date.now();
    this.setupDetectionTimer();
  },
  
  onSelectionEnd: function(pos) {
    var clipButton = this._clipButton;
    if (!clipButton) {
      clipButton = this._clipButton = document.createElement("button");
      clipButton.className = "clipButton bypassSelection";
      clipButton.innerHTML = "Clip";
      clipButton.style.zIndex = 1;
      clipButton.addEventListener("click", function(event) {
        this.doClip();
      }.bind(this), false);
      this.bbLayerDiv.appendChild(clipButton);
    }
    var tempBB = this.getSelectionBB();
    clipButton.style.left = tempBB.left + "px";
    clipButton.style.top = tempBB.top + "px";
    clipButton.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";
  },
  
  onSelectionMove: function(pos) {
    var selectionBB = this.selectionBB;
    var selectionDiv = this.selectionDiv;

    selectionBB.width = pos.left - selectionBB.left + 1;
    selectionBB.height = pos.top - selectionBB.top + 1;
    
    var tempBB = this.getSelectionBB();
    
    selectionDiv.style.left = tempBB.left + "px";
    selectionDiv.style.top = tempBB.top + "px";
    selectionDiv.style.width = tempBB.width + "px";
    selectionDiv.style.height = tempBB.height + "px";
    selectionDiv.style.visibility = this.isSelectionVisible() ? "visible" : "hidden";

    this._lastSelectionAction = Date.now();
    this.setupDetectionTimer();
  },
  
  getSelectionBB: function() {
    var selectionBB = this.selectionBB;
    if (!BoundingBoxLayerBuilder.isBBVisible(selectionBB))
      selectionBB = this.initialBB;
    
    // handle reversed selection
    var tempBB = new BoundingBox(selectionBB.left, selectionBB.top,
      selectionBB.width, selectionBB.height);
    if (tempBB.width <= 0) {
      tempBB.left += tempBB.width - 1;
      tempBB.width = -tempBB.width + 2;
    }
    if (tempBB.height <= 0) {
      tempBB.top += tempBB.height - 1;
      tempBB.height = -tempBB.height + 2;
    }
    return tempBB;
  },
  
  isSelectionVisible: function() {
    var tempBB = this.getSelectionBB();
    return BoundingBoxLayerBuilder.isBBVisible(tempBB);
  },
  
  setupDetectionTimer: function() {
    var DETECT_DELAY = 200; // in ms
    this._setupTimer(this.doDetect, function() this._lastSelectionAction, DETECT_DELAY);
  },
  
  _setupTimer: function(action, lastActionGetter, delay) {
    // Schedule action() if user has been doing something, otherwise
    // run it right away
    var self = this;
    if (Date.now() - lastActionGetter.call(this) > delay) {
      // Do action right away
      action.call(this);
      action.renderTimer = undefined;
    } else {
      // Schedule
      if (action.renderTimer)
        clearTimeout(action.renderTimer);
      action.renderTimer = setTimeout(function() {
        self._setupTimer(action, lastActionGetter, delay);
      }, delay);
    }
  },
  
  _detectIntersectedBBs: function(callback, negativeCallback) {
    var selBB = this.getSelectionBB();
    var bbs = this.bbs;
    // iterate through every bounding box and do intersection
    bbs.forEach(function(bb, index) {
      if (selBB.intersect(bb)) {
        callback.call(this, bb, index);
      } else if (negativeCallback) {
        negativeCallback.call(this, bb, index);
      }
    }, this);
  },
  
  doClip: function() {
    var bbDivs = this.bbDivs;
    var bbContents = this.bbContents;
    var aTextContent = [];
    var aTextContentIndex = [];
    var aGraphicsContent = [];
    this._detectIntersectedBBs(function(bb, index) {
      var bbDiv = bbDivs[index];
      var content = bbContents[bbDiv.dataset.contentIdx];
      if (content.type == BoundingBoxType.TEXT) {
        aTextContent.push(content.textContent);
        aTextContentIndex.push(parseInt(bbDiv.dataset.contentIdx));
      } else {
        aGraphicsContent.push(content);
      }
    });
    var aTextContentConcat = [];
    if (aTextContent.length) {
      aTextContentConcat.push(aTextContent[0]);
      var last = aTextContent[0];
      var lastIndex = aTextContentIndex[0];
      for (var i = 1, l = aTextContent.length; i < l; i++) {
        var current = aTextContent[i];
        var currentIndex = aTextContentIndex[i];
        var concat;
        if (lastIndex + 1 !== currentIndex || !(concat = Utils.shouldConcatText(last, current, false)))
          aTextContentConcat.push(" ");
        if (concat === "dehyphen") {
          var dehyphened = Utils.dehyphenate(last, current);
          aTextContentConcat[aTextContentConcat.length - 1] = dehyphened.part1;
          current = dehyphened.part2;
        }
        aTextContentConcat.push(current);
        last = current;
        lastIndex = currentIndex;
      }
    }
    var output = {
      text: aTextContentConcat.join(""),
      graphics: aGraphicsContent
    };
    var inputJSON = document.getElementById("redrawJSON");
    inputJSON.value = JSON.stringify(output);
    document.getElementById("redrawForm").submit();
  },
  
  doDetect: function() {
    var bbDivs = this.bbDivs;
    this._detectIntersectedBBs(function(bb, index) {
      var bbDiv = bbDivs[index];
      bbDiv.classList.add("highlight");
    }, function(bb, index) {
      var bbDiv = bbDivs[index];
      bbDiv.classList.remove("highlight");
    });
  }
};

setTimeout(function() { Test.run(); }, 0);

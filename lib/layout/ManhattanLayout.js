'use strict';

var isArray = require('lodash/lang/isArray'),
    find = require('lodash/collection/find');

var LayoutUtil = require('./LayoutUtil'),
    Geometry = require('../util/Geometry');

var MIN_DISTANCE = 20;


/**
 * Returns the mid points for a manhattan connection between two points.
 *
 * @example
 *
 * [a]----[x]
 *         |
 *        [x]--->[b]
 *
 * @param  {Point} a
 * @param  {Point} b
 * @param  {String} directions
 *
 * @return {Array<Point>}
 */
module.exports.getMidPoints = function(a, b, directions) {

  directions = directions || 'h:h';

  var xmid, ymid;

  // one point, next to a
  if (directions === 'h:v') {
    return [ { x: b.x, y: a.y } ];
  } else
  // one point, above a
  if (directions === 'v:h') {
    return [ { x: a.x, y: b.y } ];
  } else
  // vertical edge xmid
  if (directions === 'h:h') {
    xmid = Math.round((b.x - a.x) / 2 + a.x);

    return [
      { x: xmid, y: a.y },
      { x: xmid, y: b.y }
    ];
  } else
  // horizontal edge ymid
  if (directions === 'v:v') {
    ymid = Math.round((b.y - a.y) / 2 + a.y);

    return [
      { x: a.x, y: ymid },
      { x: b.x, y: ymid }
    ];
  } else {
    throw new Error(
      'unknown directions: <' + directions + '>: ' +
      'directions must be specified as {a direction}:{b direction} (direction in h|v)');
  }
};


/**
 * Create a connection between the two points according
 * to the manhattan layout (only horizontal and vertical) edges.
 *
 * @param {Point} a
 * @param {Point} b
 *
 * @param {String} [directions='h:h'] specifies manhattan directions for each point as {adirection}:{bdirection}.
                   A directionfor a point is either `h` (horizontal) or `v` (vertical)
 *
 * @return {Array<Point>}
 */
module.exports.connectPoints = function(a, b, directions) {

  var points = [];

  if (!LayoutUtil.pointsAligned(a, b)) {
    points = this.getMidPoints(a, b, directions);
  }

  points.unshift(a);
  points.push(b);

  return points;
};


/**
 * Connect two rectangles using a manhattan layouted connection.
 *
 * @param {Bounds} source source rectangle
 * @param {Bounds} target target rectangle
 * @param {Point} [start] source docking
 * @param {Point} [end] target docking
 *
 * @return {Array<Point>} connection points
 */
module.exports.connectRectangles = function(source, target, start, end, options) {

  options = options || {};

  var orientation = LayoutUtil.getOrientation(source, target, MIN_DISTANCE);

  var directions = this.getDirections(source, target, options.preferVertical);

  start = start || LayoutUtil.getMidPoint(source);
  end = end || LayoutUtil.getMidPoint(target);

  // overlapping elements
  if (!directions) {
    return;
  }

  if (directions === 'h:h') {

    switch (orientation) {
      case 'top-right':
      case 'right':
      case 'bottom-right':
        start = { original: start, x: source.x, y: start.y };
        end = { original: end, x: target.x + target.width, y: end.y };
        break;
      case 'top-left':
      case 'left':
      case 'bottom-left':
        start = { original: start, x: source.x + source.width, y: start.y };
        end = { original: end, x: target.x, y: end.y };
        break;
    }
  }

  if (directions === 'v:v') {

    switch (orientation) {
      case 'top-left':
      case 'top':
      case 'top-right':
        start = { original: start, x: start.x, y: source.y + source.height };
        end = { original: end, x: end.x, y: target.y };
        break;
      case 'bottom-left':
      case 'bottom':
      case 'bottom-right':
        start = { original: start, x: start.x, y: source.y };
        end = { original: end, x: end.x, y: target.y + target.height };
        break;
    }
  }

  return this.connectPoints(start, end, directions);
};

/**
 * Repair the connection between two rectangles, of which one has been updated.
 *
 * @param {Bounds} source
 * @param {Bounds} target
 * @param {Point} [start]
 * @param {Point} [end]
 * @param {Array<Point>} waypoints
 * @param {Object} [hints]
 * @param {Boolean} hints.preferStraight
 * @param {Boolean} hints.preferVertical
 * @param {Boolean} hints.startChanged
 * @param {Boolean} hints.endChanged
 *
 * @return {Array<Point>} repaired waypoints
 */
module.exports.repairConnection = function(source, target, start, end, waypoints, hints) {

  if (isArray(start)) {
    waypoints = start;
    hints = end;

    start = LayoutUtil.getMidPoint(source);
    end = LayoutUtil.getMidPoint(target);
  }

  hints = hints || {};


  var repairedWaypoints;

  // just layout non-existing or simple connections
  // attempt to render straight lines, if required
  if (!waypoints || waypoints.length < 3) {

    if (hints.preferStraight) {
      // attempt to layout a straight line
      repairedWaypoints = this.layoutStraight(source, target, start, end, hints);
    }
  } else {
    // check if we layout from start or end
    if (hints.endChanged) {
      repairedWaypoints = this._repairConnectionSide(target, source, end, waypoints.slice().reverse());
      repairedWaypoints = repairedWaypoints && repairedWaypoints.reverse();
    } else
    if (hints.startChanged) {
      repairedWaypoints = this._repairConnectionSide(source, target, start, waypoints);
    }
    // or whether nothing seems to have changed
    else {
      repairedWaypoints = waypoints;
    }
  }

  // simply reconnect if nothing else worked
  if (!repairedWaypoints) {
    return this.connectRectangles(source, target, start, end, hints);
  }

  return repairedWaypoints;
};

function max(a, b) {
  return Math.max(a, b);
}

function min(a, b) {
  return Math.min(a, b);
}

function inRange(a, start, end) {
  return a >= start && a <= end;
}

module.exports.layoutStraight = function(source, target, start, end, hints) {

  var startX, endX, x,
      startY, endY, y;

  startX = max(source.x + 10, target.x + 10);
  endX = min(source.x + source.width - 10, target.x + target.width - 10);

  if (startX < endX) {

    if (source.width === target.width) {

      if (hints.endChanged && inRange(end.x, startX, endX)) {
        x = end.x;
      } else
      if (inRange(start.x, startX, endX)) {
        x = start.x;
      }
    }

    if (x === undefined) {
      if (source.width < target.width && inRange(start.x, startX, endX)) {
        x = start.x;
      } else
      if (source.width > target.width && inRange(end.x, startX, endX)) {
        x = end.x;
      } else {
        x = (startX + endX) / 2;
      }
    }
  }

  startY = max(source.y + 10, target.y + 10);
  endY = min(source.y + source.height - 10, target.y + target.height - 10);

  if (startY < endY) {

    if (source.height === target.height) {
      if (hints.endChanged && inRange(end.y, startY, endY)) {
        y = end.y;
      } else
      if (inRange(start.y, startY, endY)) {
        y = start.y;
      }
    }

    if (y === undefined) {
      if (source.height <= target.height && inRange(start.y, startY, endY)) {
        y = start.y;
      } else
      if (target.height <= source.height && inRange(end.y, startY, endY)) {
        y = end.y;
      } else {
        y = (startY + endY) / 2;
      }
    }
  }

  // cannot layout straight
  if (x === undefined && y === undefined) {
    return null;
  }

  return [
    {
      x: x !== undefined ? x : start.x,
      y: y !== undefined ? y : start.y
    },
    {
      x: x !== undefined ? x : end.x,
      y: y !== undefined ? y : end.y
    }
  ];
};


/**
 * Repair a connection from one side that moved.
 *
 * @param  {Bounds} moved
 * @param  {Bounds} other
 * @param  {Point} newDocking
 * @param  {Array<Point>} points originalPoints from moved to other
 *
 * @return {Array<Point>} the repaired points between the two rectangles
 */
module.exports._repairConnectionSide = function(moved, other, newDocking, points) {

  function needsRelayout(moved, other, points) {

    if (points.length < 3) {
      return true;
    }

    if (points.length > 4) {
      return false;
    }

    // relayout if two points overlap
    // this is most likely due to
    return !!find(points, function(p, idx) {
      var q = points[idx - 1];

      return q && Geometry.distance(p, q) < 3;
    });
  }

  function repairBendpoint(candidate, oldPeer, newPeer) {

    var alignment = LayoutUtil.pointsAligned(oldPeer, candidate);

    switch (alignment) {
      case 'v':
        // repair vertical alignment
        return { x: candidate.x, y: newPeer.y };
      case 'h':
        // repair horizontal alignment
        return { x: newPeer.x, y: candidate.y };
    }

    return { x: candidate.x, y: candidate. y };
  }

  function removeOverlapping(points, a, b) {
    var i;

    for (i = points.length - 2; i !== 0; i--) {

      // intersects (?) break, remove all bendpoints up to this one and relayout
      if (Geometry.pointInRect(points[i], a, MIN_DISTANCE) ||
          Geometry.pointInRect(points[i], b, MIN_DISTANCE)) {

        // return sliced old connection
        return points.slice(i);
      }
    }

    return points;
  }


  // (0) only repair what has layoutable bendpoints

  // (1) if only one bendpoint and on shape moved onto other shapes axis
  //     (horizontally / vertically), relayout

  if (needsRelayout(moved, other, points)) {
    return null;
  }

  var oldDocking = points[0],
      newPoints = points.slice(),
      slicedPoints;

  // (2) repair only last line segment and only if it was layouted before

  newPoints[0] = newDocking;
  newPoints[1] = repairBendpoint(newPoints[1], oldDocking, newDocking);


  // (3) if shape intersects with any bendpoint after repair,
  //     remove all segments up to this bendpoint and repair from there

  slicedPoints = removeOverlapping(newPoints, moved, other);
  if (slicedPoints !== newPoints) {
    return this._repairConnectionSide(moved, other, newDocking, slicedPoints);
  }

  return newPoints;
};

/**
 * Returns the default manhattan directions connecting two rectangles.
 *
 * @param {Bounds} source
 * @param {Bounds} target
 * @param {Boolean} preferVertical
 *
 * @return {String}
 */
module.exports.getDirections = function(source, target, preferVertical) {
  var orientation = LayoutUtil.getOrientation(source, target, MIN_DISTANCE);

  switch (orientation) {
    case 'intersect':
      return null;

    case 'top':
    case 'bottom':
      return 'v:v';

    case 'left':
    case 'right':
      return 'h:h';

    default:
      return preferVertical ? 'v:v' : 'h:h';
  }
};
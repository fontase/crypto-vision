/**
 * Crypto Vision — DePIN Route
 *
 * Decentralized Physical Infrastructure Network data from DePINscan.
 *
 * GET /api/depin/projects           — All DePIN projects
 * GET /api/depin/project/:slug      — Single project detail
 * GET /api/depin/categories         — Project categories
 * GET /api/depin/metrics            — Aggregate DePIN metrics
 */

import { Hono } from "hono";
import * as depin from "../sources/depinscan.js";

export const depinRoutes = new Hono();

depinRoutes.get("/projects", async (c) => {
  const data = await depin.getProjects();
  return c.json({ count: Array.isArray(data) ? data.length : 0, data });
});

depinRoutes.get("/project/:slug", async (c) => {
  const slug = c.req.param("slug");
  const data = await depin.getProject(slug);
  return c.json(data);
});

depinRoutes.get("/categories", async (c) => {
  const data = await depin.getCategories();
  return c.json(data);
});

depinRoutes.get("/metrics", async (c) => {
  const data = await depin.getMetrics();
  return c.json(data);
});

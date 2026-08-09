import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("project/:projectId", "routes/project.tsx", [
    index("routes/project._index.tsx"),
    route("file/:fileId", "routes/project.file.tsx"),
    route("search/:searchId", "routes/project.search.tsx"),
  ]),
] satisfies RouteConfig

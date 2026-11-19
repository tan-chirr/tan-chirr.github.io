import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { documents, projects, sources } from "./research-data.mjs";

const homepage = new URL("./index.html", import.meta.url);
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const link = (url, label) => `<a href="${escape(url)}">${escape(label)}</a>`;

function projectSummary(project) {
  const metadata = [project.period, project.institution, project.status].filter(Boolean).join(" · ");
  const materials = (project.documents ?? []).flatMap(key => {
    const [title, filename] = documents[key];
    const path = `research/assets/${filename}`;
    return existsSync(new URL(path, homepage)) ? [link(path, `View ${title} (PDF)`)] : [];
  });
  const evidence = (project.resources ?? []).map(key => {
    const [title, url] = sources[key];
    return link(url, title);
  });
  const links = [...materials, ...evidence];
  const linkList = links.length ? `<div class="paper-links">${links.join(" ")}</div>` : "";
  const supportingContent = project.more
    ? `<details class="project-more"><summary>Read more</summary><p>${escape(project.more)}</p>${linkList}</details>`
    : linkList;
  return `        <article class="project" id="${escape(project.slug)}">
          <div class="project-copy">
            <p class="eyebrow">${escape(metadata)}</p>
            <h3>${escape(project.title)}</h3>${project.summary ? `
            <p>${escape(project.summary)}</p>` : ""}${supportingContent ? `
            ${supportingContent}` : ""}
          </div>
        </article>`;
}

const html = readFileSync(homepage, "utf8");
const markers = /(        <!-- Research projects start -->)\r?\n[\s\S]*?(        <!-- Research projects end -->)/;
if (!markers.test(html)) throw new Error("Research project markers are missing from index.html.");
writeFileSync(homepage, html.replace(markers, (_, start, end) =>
  `${start}\n${projects.map(projectSummary).join("\n")}\n${end}`));

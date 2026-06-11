import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAIN_TEX = `\\documentclass{article}

\\title{LaTeX Studio Demo}
\\author{You}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Hello}
Welcome to your locally-hosted LaTeX Studio. This minimal document compiles
with \\texttt{latexmk}.

\\begin{equation}
  e^{i\\pi} + 1 = 0
\\end{equation}

\\end{document}
`;

async function main(): Promise<void> {
  const existing = await prisma.project.findFirst({ where: { name: 'Demo Project' } });
  if (existing) {
    console.log(`Demo project already exists (id=${existing.id}); nothing to seed.`);
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: 'Demo Project',
      rootFile: 'main.tex',
      files: {
        create: [{ path: 'main.tex', content: MAIN_TEX }],
      },
    },
    include: { files: true },
  });

  console.log(`Seeded "${project.name}" (id=${project.id}) with ${project.files.length} file(s).`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

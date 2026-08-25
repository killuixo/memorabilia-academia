import React, { useState, useEffect, useRef } from 'react';

// ==========================================
// CONFIGURAÇÕES DO APLICATIVO
// ==========================================
const getGoogleScriptUrl = () => {
  try {
    return import.meta.env.VITE_GOOGLE_SCRIPT_URL || "";
  } catch (error) {
    return ""; 
  }
};

const GOOGLE_SCRIPT_URL = getGoogleScriptUrl();

// ==========================================
// FUNÇÕES UTILITÁRIAS PARA A CÂMERA (OCR)
// ==========================================
const resizeImageForOCR = (file, maxWidth = 1200) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = img.height * (maxWidth / img.width);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png', 1.0)); 
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

const parseExtractedText = (rawText) => {
  let parsed = { centro: '', curso: '', disciplina: '', orientador: '', estudante1: '', estudante2: '', estudante3: '', mesAno: '' };
  
  const fullText = rawText.replace(/\n/g, ' ');
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 2);

  // 1. Extrair Centro e Curso em linhas isoladas
  lines.forEach(line => {
    if (/^CENTRO DE/i.test(line)) parsed.centro = line.replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
    if (/^CURSO DE/i.test(line)) {
      let textCurso = line.replace(/^CURSO DE/i, '');
      textCurso = textCurso.replace(/\b(?:da|de)\s+(?:universidade|ufsc).*/i, ''); // Tesoura se houver "da Universidade"
      parsed.curso = textCurso.replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
    }
  });

  // 2. Extrair Disciplina (Tenta o padrão explícito ou deduz pela linha anterior ao Orientador)
  let discMatch = rawText.match(/Disciplina:?\s*([^\n]+)/i) || fullText.match(/estágio de\s+([a-zA-ZÀ-ÿ\s]+)(?:,|\.)/i);
  if (discMatch) {
    parsed.disciplina = discMatch[1].replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
  } else {
    let profIndex = lines.findIndex(l => /(?:Prof[a-zªº.]*|Professor[a]?|Orientador[a]?)/i.test(l));
    if (profIndex > 0) {
      let lineAbove = lines[profIndex - 1];
      if (!/DEPARTAMENTO|CENTRO|CURSO/i.test(lineAbove)) {
         parsed.disciplina = lineAbove.replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
      }
    }
  }

  // 3. Extrair Curso (Caso esteja no meio de um parágrafo em vez de linha isolada)
  if (!parsed.curso) {
    let cursoMatch = fullText.match(/curso de\s+([a-zA-ZÀ-ÿ\s]+?)(?:,|\.|\s+(?:da|de)\s+(?:universidade|ufsc)|$)/i);
    if (cursoMatch) parsed.curso = cursoMatch[1].replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
  }

  // 4. Extrair Orientador(a) (Agora tolerante a Professora: com dois pontos)
  let oriMatch = rawText.match(/(?:Prof[a-zªº.]*|Professor[a]?|Orientador[a]?)[.:\s]*([A-Z][a-zA-ZÀ-ÿ\s]+)/i);
  if (oriMatch) parsed.orientador = oriMatch[1].split('\n')[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();

  // 5. Extrair Mês e Ano
  let dateMatch = fullText.match(/([a-zA-Zç]+)\s+de\s+(20\d{2}|19\d{2})/i);
  if (dateMatch) {
    const monthMap = { 'janeiro':'01','fevereiro':'02','março':'03','abril':'04','maio':'05','junho':'06','julho':'07','agosto':'08','setembro':'09','outubro':'10','novembro':'11','dezembro':'12'};
    let month = monthMap[dateMatch[1].toLowerCase()] || '01';
    parsed.mesAno = `${dateMatch[2]}-${month}`;
  }

  // 6. Extrair Estudantes (Aceitando Aluna, Aluno, Acadêmicos, Acadêmicas e ignorando lixo como "Turma")
  let acadMatch = rawText.match(/(?:Acad[eê]mic[oa]s?|Alun[oa]s?)[:\s]*([\s\S]*?)(?:Florian[oó]polis|Relat[oó]rio|Turma|$)/i);
  let students = [];
  
  if (acadMatch) {
    students = acadMatch[1].split('\n')
      .map(l => l.split('-')[0]) // Quebra no hífen e joga fora a parte do "- Turma"
      .map(l => l.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim())
      .filter(l => l.length > 4 && l.includes(' '));
  } else {
    students = lines.slice(0, 6)
      .filter(l => /^[A-Z][a-zÀ-ÿ]+\s+[A-Z][a-zÀ-ÿ]+/.test(l))
      .map(l => l.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim());
  }
  
  if (students[0]) parsed.estudante1 = students[0];
  if (students[1]) parsed.estudante2 = students[1];
  if (students[2]) parsed.estudante3 = parsed.estudante3 || students[2];

  return parsed;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('registro'); 
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data/Hora', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const initialFormState = {
    pacote: '', idItem: '', centro: '', curso: '',
    estudante1: '', estudante2: '', estudante3: '', orientador: '',
    disciplina: '', mesAno: '', codigo: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  
  // OCR States
  const [ocrStatus, setOcrStatus] = useState('idle');
  const fileInputRef = useRef(null);

  const fetchItems = async () => {
    if (!GOOGLE_SCRIPT_URL) return;
    setLoadingList(true);
    setFetchError('');
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL);
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
           setItems(data);
        } else {
           setFetchError("Erro: A resposta não é uma lista válida.");
        }
      } catch(e) {
        setFetchError("Erro de formatação JSON no Script.");
      }
    } catch (err) {
      setFetchError("Falha de comunicação com a planilha.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (activeTab === 'acervo') fetchItems();
  }, [activeTab]);

  // Autocomplete e sugestão de ID baseado estritamente no último item da planilha
  useEffect(() => {
    if (items.length === 0) return;

    // Pega ESTRITAMENTE a última linha carregada da planilha
    const lastItem = items[items.length - 1]; 

    setFormData(prev => {
      let updates = {};

      const autoPacote = lastItem["ID Pacote"] || '';
      if (!prev.pacote && autoPacote) updates.pacote = autoPacote;

      // Pega o ID Item anterior (ex: "REL-CFH-008") da última linha e transforma em "REL-CFH-009"
      const lastIdItem = lastItem["ID Item"] || '';
      if (lastIdItem && !prev.idItem) {
        const match = lastIdItem.match(/^(.*?)(\d+)$/);
        if (match) {
          const prefix = match[1];
          const numStr = match[2];
          const nextNum = parseInt(numStr, 10) + 1;
          updates.idItem = `${prefix}${String(nextNum).padStart(numStr.length, '0')}`;
        }
      }

      if (Object.keys(updates).length > 0) {
          return { ...prev, ...updates };
      }
      return prev;
    });
  }, [items]);

  // Extração das listas únicas para o Autocompletar (Datalists)
  const uniqueCursos = [...new Set(items.map(i => i["Curso"]).filter(Boolean))];
  const uniqueDisciplinas = [...new Set(items.map(i => i["Disciplina"]).filter(Boolean))];
  const uniqueOrientadores = [...new Set(items.map(i => i["Orientador"]).filter(Boolean))];
  const uniqueEstudantes = [...new Set([
      ...items.map(i => i["Estudante 1"]),
      ...items.map(i => i["Estudante 2"]),
      ...items.map(i => i["Estudante 3"])
  ].filter(Boolean))];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
      // Carrega o Tesseract.js sob demanda (grátis e no navegador)
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const base64Image = await resizeImageForOCR(file);
      
      const worker = await window.Tesseract.createWorker('por');
      const ret = await worker.recognize(base64Image);
      const text = ret.data.text;
      await worker.terminate();

      // Passa o texto para o nosso filtro inteligente
      const parsedData = parseExtractedText(text);

      setFormData(prev => ({
        ...prev,
        centro: parsedData.centro || prev.centro,
        curso: parsedData.curso || prev.curso,
        disciplina: parsedData.disciplina || prev.disciplina,
        orientador: parsedData.orientador || prev.orientador,
        mesAno: parsedData.mesAno || prev.mesAno,
        estudante1: parsedData.estudante1 || prev.estudante1,
        estudante2: parsedData.estudante2 || prev.estudante2,
        estudante3: parsedData.estudante3 || prev.estudante3,
      }));

      setOcrStatus('success');
      setTimeout(() => setOcrStatus('idle'), 3000);
      
    } catch (err) {
      console.error(err);
      setOcrStatus('error');
      setTimeout(() => setOcrStatus('idle'), 4000);
    }
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmAndSubmit = async () => {
    setShowConfirm(false);
    if (!GOOGLE_SCRIPT_URL) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain para contornar CORS
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      
      // Limpa os dados do formulário, mas mantém o pacote, centro e curso para agilizar
      setFormData(prev => ({
        ...initialFormState,
        pacote: prev.pacote,
        centro: prev.centro,
        curso: prev.curso,
        idItem: '' // Deixa em branco para o useEffect de ID preencher o próximo número
      }));
      
      fetchItems(); // Atualiza o acervo 
      setTimeout(() => setStatus('idle'), 3000);
    } catch (error) {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const sortedItems = [...items].sort((a, b) => {
    const aValue = a[sortConfig.key] ? a[sortConfig.key].toString().toLowerCase() : '';
    const bValue = b[sortConfig.key] ? b[sortConfig.key].toString().toLowerCase() : '';
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#f4f4f0] flex flex-col items-center py-6 px-4 font-sans selection:bg-[#ffb300]">
      <div className="w-full max-w-6xl bg-white border-[8px] md:border-[12px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        
        <div className="flex flex-col md:flex-row border-b-[8px] md:border-b-[12px] border-black">
          <div className="bg-[#c2185b] flex-1 p-6 text-white border-b-[8px] md:border-b-0 md:border-r-[12px] border-black">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter">Acervo MEN</h1>
            <p className="mt-1 text-pink-200 font-bold text-base md:text-lg">Triagem Arquivística de Relatórios</p>
          </div>
          <div className="flex flex-row md:flex-col bg-[#ffb300] min-w-[250px]">
            <button 
              onClick={() => setActiveTab('registro')}
              className={`flex-1 px-4 py-4 font-black uppercase tracking-wider text-sm md:text-xl border-b-[8px] md:border-b-[12px] border-black transition-colors ${activeTab === 'registro' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Registrar
            </button>
            <button 
              onClick={() => setActiveTab('acervo')}
              className={`flex-1 px-4 py-4 font-black uppercase tracking-wider text-sm md:text-xl transition-colors ${activeTab === 'acervo' ? 'bg-white text-black' : 'text-black hover:bg-[#ffe082]'}`}
            >
              Ver Acervo
            </button>
          </div>
        </div>

        {activeTab === 'registro' && (
          <div className="flex flex-col bg-white p-6 relative">
            
            {/* Listas Suspensas Injetadas Ocultas (Datalists) */}
            <datalist id="codigosSiga">
              <option value="125.31 - Provas. Exames. Trabalhos" />
              <option value="125.41 - Histórico escolar. Integralização curricular" />
              <option value="125.42 - Emissão de diploma" />
              <option value="125.43 - Assentamentos individuais dos alunos (Dossiês)" />
            </datalist>
            
            <datalist id="listaCursos">
              {uniqueCursos.map((curso, idx) => <option key={idx} value={curso} />)}
            </datalist>
            
            <datalist id="listaDisciplinas">
              {uniqueDisciplinas.map((disc, idx) => <option key={idx} value={disc} />)}
            </datalist>
            
            <datalist id="listaOrientadores">
              {uniqueOrientadores.map((ori, idx) => <option key={idx} value={ori} />)}
            </datalist>

            <datalist id="listaEstudantes">
              {uniqueEstudantes.map((est, idx) => <option key={idx} value={est} />)}
            </datalist>

            {/* BOTÃO CÂMERA DISCRETO */}
            <div className="flex justify-between items-center mb-6 border-b-[4px] border-black pb-4">
              <span className="font-black text-gray-400 uppercase tracking-widest text-sm">Ficha de Inserção</span>
              
              <button 
                type="button"
                onClick={() => fileInputRef.current.click()}
                className="flex items-center gap-2 px-3 py-2 bg-white border-[3px] border-black text-black font-black text-xs uppercase hover:bg-gray-100 transition-colors cursor-pointer shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none"
              >
                <span role="img" aria-label="Camera">📷</span>
                {ocrStatus === 'loading' ? 'Lendo Capa...' : 'Ler Capa (Câmera)'}
              </button>

              <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleImageCapture} className="hidden" />
            </div>

            {ocrStatus === 'success' && <div className="mb-6 p-3 bg-[#00bcd4] border-[3px] border-black font-black text-sm uppercase text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">✓ Campos preenchidos! Por favor, revise.</div>}
            {ocrStatus === 'error' && <div className="mb-6 p-3 bg-[#c2185b] border-[3px] border-black font-black text-sm uppercase text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">⚠ Erro ao processar a imagem. Tente novamente ou preencha manualmente.</div>}

            {showConfirm ? (
              <div className="flex flex-col gap-6 animate-in fade-in duration-300">
                <h2 className="text-3xl font-black uppercase text-[#c2185b] mb-2 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm md:text-base">
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Curso:</strong> <br/>{formData.curso || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Disciplina:</strong> <br/>{formData.disciplina || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Estudantes:</strong> <br/>{[formData.estudante1, formData.estudante2, formData.estudante3].filter(Boolean).join(' | ') || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Orientador(a):</strong> <br/>{formData.orientador || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Mês/Ano:</strong> <br/>{formData.mesAno || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Código SIGA:</strong> <br/>{formData.codigo || '-'}</div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 mt-4">
                   <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-cyan-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none">Salvar na Planilha</button>
                   <button onClick={() => setShowConfirm(false)} className="flex-1 bg-white border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none">Voltar</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handlePreSubmit} className="flex flex-col gap-8">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#e0f7fa] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">ID Pacote *</label>
                    <input required type="text" name="pacote" value={formData.pacote} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-white uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b]">ID Item *</label>
                    <input required type="text" name="idItem" value={formData.idItem} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg font-mono focus:outline-none focus:bg-[#f8bbd0] uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#ffe082] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Centro *</label>
                    <input required type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Curso *</label>
                    <input required type="text" list="listaCursos" name="curso" value={formData.curso} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Disciplina</label>
                    <input type="text" list="listaDisciplinas" name="disciplina" value={formData.disciplina} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">Orientador(a)</label>
                    <input type="text" list="listaOrientadores" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t-[4px] border-black border-dashed">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Estudante 1 *</label>
                      <input required type="text" list="listaEstudantes" name="estudante1" value={formData.estudante1} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 2</label>
                      <input type="text" list="listaEstudantes" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 3</label>
                      <input type="text" list="listaEstudantes" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#f8bbd0] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Mês e Ano *</label>
                    <input required type="month" name="mesAno" value={formData.mesAno} onChange={handleChange} className="w-full border-[4px] border-black p-3 text-lg focus:outline-none focus:bg-white uppercase font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Código SIGA / IFES</label>
                    <input type="text" list="codigosSiga" name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" placeholder="Selecione na lista suspensa..." />
                  </div>
                  <div className="col-span-1 md:col-span-2 flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Observações</label>
                    <textarea name="observacoes" value={formData.observacoes} onChange={handleChange} rows="2" className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white resize-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <button type="submit" disabled={status === 'loading'} className="mt-2 w-full bg-[#c2185b] text-white border-[6px] border-black py-5 font-black text-2xl md:text-3xl uppercase tracking-wider hover:bg-[#d81b60] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-y-1 disabled:translate-x-1">
                  {status === 'loading' ? 'Verificando...' : 'Revisar Informações'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Aba do Acervo para Listagem */}
        {activeTab === 'acervo' && (
          <div className="p-6 md:p-8 flex flex-col bg-white overflow-hidden min-h-[500px]">
            {fetchError && (
              <div className="mb-6 bg-red-200 border-[4px] border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="font-black text-red-900 uppercase">⚠ Erro:</p><p className="font-bold text-sm mt-1">{fetchError}</p>
              </div>
            )}
            
            {loadingList ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="font-black text-2xl uppercase animate-pulse">Consultando Planilha...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-[6px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#00bcd4] text-black">
                      {["Data/Hora", "ID Pacote", "ID Item", "Centro", "Curso", "Estudante 1", "Disciplina", "Mês/Ano"].map((header) => (
                        <th key={header} onClick={() => handleSort(header)} className="border-b-[6px] border-r-[4px] border-black p-4 font-black uppercase text-sm cursor-pointer hover:bg-cyan-300 last:border-r-0">
                          {header} {sortConfig.key === header && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-gray-50">
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="8" className="p-8 text-center font-bold text-gray-500 uppercase">O Acervo está Vazio.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-yellow-100 border-b-[4px] border-black last:border-b-0">
                          <td className="p-4 font-mono text-xs border-r-[4px] border-black">{item["Data/Hora"]}</td>
                          <td className="p-4 font-black border-r-[4px] border-black">{item["ID Pacote"]}</td>
                          <td className="p-4 font-black text-[#c2185b] border-r-[4px] border-black">{item["ID Item"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Centro"]?.substring(0,20)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Curso"]?.substring(0,20)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Estudante 1"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Disciplina"]?.substring(0,20)}</td>
                          <td className="p-4 font-black bg-[#ffe082]">{item["Mês/Ano"]}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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

const toTitleCase = (str) => {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
            .replace(/\b(De|Do|Da|Dos|Das|E|Em)\b/g, (a) => a.toLowerCase())
            .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi)\b/g, (a) => a.toUpperCase());
};

// ==========================================
// LÓGICA ARQUIVÍSTICA E EXTRAÇÃO DE CAPAS E PROCESSOS
// ==========================================
const parseExtractedText = (rawText) => {
  let parsed = { 
    centro: '', 
    origem: '', 
    disciplina: '', 
    orientador: '', 
    produtor: '', 
    estudante2: '', 
    estudante3: '', 
    dataDocumento: '',
    tipoDocumental: '',
    serie: '',
    codigo: ''
  };
  
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = rawLines.join(' ');
  const upperFullText = fullText.toUpperCase();

  // 1. Centro (Sua Sigla)
  let centroLine = rawLines.find(l => /^CENTRO\b/i.test(l) || /\b(CCE|CED|CFH|CTC|CDS|CCB|CFM|CCS|CCJ|CCA|CSE)\b/i.test(l));
  if (centroLine) {
      let match = centroLine.match(/(?:-|–|—)\s*([A-Z]{3,4})\b/);
      if (match) {
          parsed.centro = match[1];
      } else {
          const upper = centroLine.toUpperCase();
          if (upper.includes('COMUNICA') || upper.includes('EXPRESS')) parsed.centro = 'CCE';
          else if (upper.includes('EDUCA')) parsed.centro = 'CED';
          else if (upper.includes('FILOSOFIA') || upper.includes('HUMANAS')) parsed.centro = 'CFH';
          else if (upper.includes('TECNOL')) parsed.centro = 'CTC';
          else if (upper.includes('DESPORTO') || upper.includes('FISICA')) parsed.centro = 'CDS';
          else if (upper.includes('BIOLOG')) parsed.centro = 'CCB';
          else if (upper.includes('SAUDE') || upper.includes('SAÚDE')) parsed.centro = 'CCS';
          else if (upper.includes('JURID') || upper.includes('DIREITO')) parsed.centro = 'CCJ';
          else if (upper.includes('AGRAR')) parsed.centro = 'CCA';
          else if (upper.includes('SOCIO') || upper.includes('ECONOM')) parsed.centro = 'CSE';
          else {
              let matchSigla = centroLine.match(/\b([A-Z]{3,4})\b/);
              parsed.centro = matchSigla ? matchSigla[1] : '';
          }
      }
  } else if (upperFullText.includes('MEN/CED') || upperFullText.includes('CED')) {
      parsed.centro = 'CED';
  } else if (upperFullText.includes('CCE')) {
      parsed.centro = 'CCE';
  } else if (upperFullText.includes('CFH')) {
      parsed.centro = 'CFH';
  }

  // 2. Origem / Curso
  let origemLine = rawLines.find(l => /^ORIGEM[:\s]*|^CURSO\b/i.test(l));
  if (origemLine) {
     let textOrigem = origemLine.replace(/^(?:ORIGEM|CURSO(?: DE)?)[:\s]*/i, '');
     textOrigem = textOrigem.replace(/\b(?:da|de)\s+(?:universidade|ufsc).*/i, '');
     textOrigem = textOrigem.replace(/(?:-|–|—)\s*[A-Z0-9/]+\s*$/, '');
     parsed.origem = toTitleCase(textOrigem.replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
  } else {
     let cursoMatch = fullText.match(/curso\s+(?:de\s+)?([a-zA-ZÀ-ÿ\s/-]+?)(?:,|\.|\s+(?:da|de)\s+(?:universidade|ufsc)|$)/i);
     if (cursoMatch) {
       parsed.origem = toTitleCase(cursoMatch[1].replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
     } else if (upperFullText.includes('MEN/CED') || upperFullText.includes('METODOLOGIA DE ENSINO')) {
       parsed.origem = 'Metodologia de Ensino';
     }
  }

  // 3. Produtor / Requerente / Estudante
  let reqLine = rawLines.find(l => /(?:Requerente|Interessado)[:\s]*/i.test(l));
  if (reqLine) {
      // É capa de PROCESSO
      let prodText = reqLine.replace(/^(?:Requerente|Interessado)[:\s]*/i, '');
      prodText = prodText.split(/(?:-|–|—)/)[0];
      parsed.produtor = toTitleCase(prodText.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim());
  } else {
      // É capa de RELATÓRIO
      let rawStudentIndex = rawLines.findIndex(l => /^(?:Acad[eê]mic[oa]s?\s*:?|Alun[oa]s?\s*:?)\b/i.test(l));
      let students = [];
      if (rawStudentIndex !== -1) {
          let firstStudentLine = rawLines[rawStudentIndex].replace(/^(?:Acad[eê]mic[oa]s?\s*:?|Alun[oa]s?\s*:?)\s*/i, '');
          let cleanedFirst = firstStudentLine.split(/(?:-|–|—)/)[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
          if (cleanedFirst.includes(' ') && cleanedFirst.length > 4) students.push(toTitleCase(cleanedFirst));
          
          for (let i = rawStudentIndex + 1; i <= rawStudentIndex + 2 && i < rawLines.length; i++) {
              if (rawLines[i].length <= 2 || rawLines[i].trim() === '') break; 
              let cleaned = rawLines[i].split(/(?:-|–|—)/)[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
              if (cleaned.includes(' ') && cleaned.length > 4 && !/["“”:]/.test(rawLines[i])) {
                  students.push(toTitleCase(cleaned));
              } else {
                  break;
              }
          }
      } else {
          // Busca no topo da página
          let topLines = rawLines.slice(0, 6).filter(l => !/UNIVERSIDADE|FEDERAL|CENTRO|CURSO|DISCIPLINA|TRABALHO|RELATÓRIO|SUMÁRIO|PROCESSO|"/i.test(l));
          for (let l of topLines) {
              let cleaned = l.split(/(?:-|–|—)/)[0].replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim();
              if (cleaned.includes(' ') && cleaned.length > 5 && cleaned.length < 50 && !/["“”:]/.test(l)) {
                  students.push(toTitleCase(cleaned));
              }
          }
      }
      if (students[0]) parsed.produtor = students[0];
      if (students[1]) parsed.estudante2 = students[1];
      if (students[2]) parsed.estudante3 = students[2];
  }

  // 4. Orientador(a) / Professora
  let profLine = rawLines.find(l => /(?:Prof|Professor|Orientador)/i.test(l));
  if (profLine) {
      let profText = profLine.replace(/^(.*?(?:Prof[a-zªº.]*|Professor[a]?|Orientador[a]?)[.:\s]*)/i, '');
      profText = profText.replace(/^(?:Mst|Dra?|MSc|Esp)\b[.:\s]*/i, '');
      parsed.orientador = toTitleCase(profText.replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim());
  }

  // 5. Assunto / Disciplina
  let assuntoLine = rawLines.find(l => /^(?:Assunto|Detalhamento)[:\s]*/i.test(l));
  if (assuntoLine) {
      let textAssunto = assuntoLine.replace(/^(?:Assunto|Detalhamento)[:\s]*/i, '');
      parsed.disciplina = toTitleCase(textAssunto.trim());
  } else {
      let discLine = rawLines.find(l => /^DISCIPLINA[:\s]*/i.test(l));
      if (discLine) {
         let textDisc = discLine.replace(/^DISCIPLINA[:\s]*/i, '').replace(/(?:-|–|—)\s*[A-Z]{3}\s*\d{4}.*/i, '');
         parsed.disciplina = toTitleCase(textDisc.replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
      } else {
         let discMatch = fullText.match(/disciplina\s+(?:de\s+)?([a-zA-ZÀ-ÿ\s/IV]+?)(?:,|\.|\s+do curso|\s+da universidade|$)/i);
         if (discMatch) {
            parsed.disciplina = toTitleCase(discMatch[1].replace(/[^a-zA-ZÀ-ÿ\s/IV]/gi, '').trim());
         } else if (profLine) {
            let profIndex = rawLines.indexOf(profLine);
            if (profIndex > 0) {
               let lineAbove = rawLines[profIndex - 1];
               if (!/CENTRO|CURSO|UNIVERSIDADE/i.test(lineAbove)) {
                  parsed.disciplina = toTitleCase(lineAbove.replace(/[^a-zA-ZÀ-ÿ\s/-]/g, '').trim());
               }
            }
         }
      }
  }

  // 6. Data do Documento
  let dateMatch = fullText.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (dateMatch) {
      let year = dateMatch[3].length === 2 ? (parseInt(dateMatch[3]) > 50 ? '19'+dateMatch[3] : '20'+dateMatch[3]) : dateMatch[3];
      let month = dateMatch[2].padStart(2, '0');
      parsed.dataDocumento = `${year}-${month}`;
  } else {
      let textDateMatch = fullText.match(/([a-zA-Zç]+)\s+de\s+(20\d{2}|19\d{2})/i);
      if (textDateMatch) {
          const monthMap = { 'janeiro':'01','fevereiro':'02','março':'03','abril':'04','maio':'05','junho':'06','julho':'07','agosto':'08','setembro':'09','outubro':'10','novembro':'11','dezembro':'12'};
          let month = monthMap[textDateMatch[1].toLowerCase()] || '01';
          parsed.dataDocumento = `${textDateMatch[2]}-${month}`;
      } else {
          let stampMatch = fullText.match(/23080\.(\d{6})\/(\d{2,4})/);
          if(stampMatch) {
              let year = stampMatch[2].length === 2 ? (parseInt(stampMatch[2]) > 50 ? '19'+stampMatch[2] : '20'+stampMatch[2]) : stampMatch[2];
              parsed.dataDocumento = `${year}-01`;
          } else {
              let yearMatch = fullText.match(/\b(19\d{2}|20\d{2})\b/g);
              if (yearMatch) parsed.dataDocumento = `${yearMatch[yearMatch.length - 1]}-01`;
          }
      }
  }

  // 7. Inteligência Arquivística (Tipo Documental, Série e Código IFES/Arquivo Nacional)
  if (upperFullText.includes('PROGRESSÃO') || upperFullText.includes('PROGRESSAO') || upperFullText.includes('PROMOÇÃO') || upperFullText.includes('PROMOCAO')) {
      parsed.tipoDocumental = upperFullText.includes('MEMORIAL') ? 'Memorial Descritivo' : 'Processo Administrativo';
      parsed.serie = 'Processos de Progressão Funcional';
      parsed.codigo = "022.63 - Promoção e progressão funcional";
  } else if (upperFullText.includes('ESTÁGIO PROBATÓRIO') || upperFullText.includes('ESTAGIO PROBATORIO')) {
      parsed.tipoDocumental = upperFullText.includes('MEMORIAL') ? 'Memorial Descritivo' : 'Processo Administrativo';
      parsed.serie = 'Processos de Estágio Probatório';
      parsed.codigo = "022.61 - Cumprimento de estágio probatório. Homologação da estabilidade";
  } else if (upperFullText.includes('AFASTAMENTO') || upperFullText.includes('EVENTO') || upperFullText.includes('VIAGEM')) {
      parsed.tipoDocumental = 'Processo Administrativo';
      if (upperFullText.includes('EXTERIOR') || upperFullText.includes('PAÍS') || upperFullText.includes('PAIS')) {
          parsed.serie = 'Afastamentos para o Exterior';
          parsed.codigo = "028.21 - CUMPRIMENTO DE MISSÕES E VIAGENS A SERVIÇO - NO EXTERIOR - COM ÔNUS";
      } else {
          parsed.serie = 'Afastamentos no País';
          parsed.codigo = "028.11 - CUMPRIMENTO DE MISSÕES E VIAGENS A SERVIÇO - NO PAÍS - COM ÔNUS";
      }
  } else if (upperFullText.includes('RELATÓRIO') || upperFullText.includes('RELATORIO') || upperFullText.includes('PRÁTICA') || upperFullText.includes('PRATICA')) {
      parsed.tipoDocumental = 'Relatório';
      parsed.serie = 'Relatórios de Estágio Obrigatório';
      parsed.codigo = "125.31 - Provas. Exames. Trabalhos";
  } else if (upperFullText.includes('TCC') || upperFullText.includes('MONOGRAFIA') || upperFullText.includes('CONCLUSÃO DE CURSO')) {
      parsed.tipoDocumental = 'Monografia / TCC';
      parsed.serie = 'Trabalhos de Conclusão de Curso';
      parsed.codigo = "125.32 - Trabalho de conclusão de curso";
  } else if (upperFullText.includes('DOSSIÊ') || upperFullText.includes('DOSSIE')) {
      parsed.tipoDocumental = 'Dossiê';
      parsed.serie = 'Assentamentos Individuais';
      parsed.codigo = "125.43 - Assentamentos individuais dos alunos (Dossiês)";
  }

  return parsed;
};

// ==========================================
// COMPONENTE PRINCIPAL (REACT APP)
// ==========================================
export default function App() {
  const [activeTab, setActiveTab] = useState('registro'); 
  const [items, setItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'Data de análise', direction: 'desc' });
  const [loadingList, setLoadingList] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const initialFormState = {
    pacote: '', idItem: '', centro: '', origem: '',
    produtor: '', estudante2: '', estudante3: '', orientador: '',
    disciplina: '', dataDocumento: '', codigo: '', tipoDocumental: '', serie: '', observacoes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [status, setStatus] = useState('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  
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

  useEffect(() => {
    if (items.length === 0) return;

    // Sugere próximo ID Item e mantém ID Pacote baseando-se estritamente na última linha da planilha
    const lastItem = items[items.length - 1]; 

    setFormData(prev => {
      let updates = {};

      const autoPacote = lastItem["ID Pacote"] || '';
      if (!prev.pacote && autoPacote) updates.pacote = autoPacote;

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

  const uniqueOrigens = [...new Set(items.map(i => i["Origem"]).filter(Boolean))];
  const uniqueDisciplinas = [...new Set(items.map(i => i["Disciplina"]).filter(Boolean))];
  const uniqueOrientadores = [...new Set(items.map(i => i["Orientador"]).filter(Boolean))];
  const uniqueProdutores = [...new Set([
      ...items.map(i => i["Produtor"]),
      ...items.map(i => i["Estudante 2"]),
      ...items.map(i => i["Estudante 3"])
  ].filter(Boolean))];
  const uniqueSeries = [...new Set(items.map(i => i["Série"]).filter(Boolean))];
  const uniqueTipos = [...new Set(items.map(i => i["Tipo Documental"]).filter(Boolean))];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setOcrStatus('loading');
    try {
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

      const parsedData = parseExtractedText(text);

      setFormData(prev => ({
        ...prev,
        centro: parsedData.centro || prev.centro,
        origem: parsedData.origem || prev.origem,
        disciplina: parsedData.disciplina || prev.disciplina,
        orientador: parsedData.orientador || prev.orientador,
        dataDocumento: parsedData.dataDocumento || prev.dataDocumento,
        produtor: parsedData.produtor || prev.produtor,
        estudante2: parsedData.estudante2 || prev.estudante2,
        estudante3: parsedData.estudante3 || prev.estudante3,
        codigo: parsedData.codigo || prev.codigo,
        tipoDocumental: parsedData.tipoDocumental || prev.tipoDocumental,
        serie: parsedData.serie || prev.serie
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
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(formData)
      });
      
      setStatus('success');
      
      setFormData(prev => ({
        ...initialFormState,
        pacote: prev.pacote,
        centro: prev.centro,
        origem: prev.origem,
        idItem: ''
      }));
      
      fetchItems();
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
            <p className="mt-1 text-pink-200 font-bold text-base md:text-lg">Triagem Arquivística Acadêmica</p>
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
            
            <datalist id="codigosSiga">
              <option value="022.61 - Cumprimento de estágio probatório. Homologação da estabilidade" />
              <option value="022.63 - Promoção e progressão funcional" />
              <option value="028.11 - CUMPRIMENTO DE MISSÕES E VIAGENS A SERVIÇO - NO PAÍS - COM ÔNUS" />
              <option value="028.21 - CUMPRIMENTO DE MISSÕES E VIAGENS A SERVIÇO - NO EXTERIOR - COM ÔNUS" />
              <option value="125.31 - Provas. Exames. Trabalhos" />
              <option value="125.32 - Trabalho de conclusão de curso" />
              <option value="125.43 - Assentamentos individuais dos alunos (Dossiês)" />
            </datalist>
            
            <datalist id="listaOrigens">
              {uniqueOrigens.map((ori, idx) => <option key={idx} value={ori} />)}
            </datalist>
            
            <datalist id="listaDisciplinas">
              {uniqueDisciplinas.map((disc, idx) => <option key={idx} value={disc} />)}
            </datalist>
            
            <datalist id="listaOrientadores">
              {uniqueOrientadores.map((ori, idx) => <option key={idx} value={ori} />)}
            </datalist>

            <datalist id="listaProdutores">
              {uniqueProdutores.map((est, idx) => <option key={idx} value={est} />)}
            </datalist>

            <datalist id="listaTipos">
              {uniqueTipos.map((tipo, idx) => <option key={idx} value={tipo} />)}
            </datalist>

            <datalist id="listaSeries">
              {uniqueSeries.map((serie, idx) => <option key={idx} value={serie} />)}
            </datalist>

            <div className="flex justify-between items-center mb-6 border-b-[4px] border-black pb-4">
              <span className="font-black text-gray-400 uppercase tracking-widest text-sm">Ficha de Inserção Arquivística</span>
              
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

            {ocrStatus === 'success' && <div className="mb-6 p-3 bg-[#00bcd4] border-[3px] border-black font-black text-sm uppercase text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">✓ Campos preenchidos automaticamente! Por favor, revise.</div>}
            {ocrStatus === 'error' && <div className="mb-6 p-3 bg-[#c2185b] border-[3px] border-black font-black text-sm uppercase text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">⚠ Erro ao processar a imagem. Tente novamente ou preencha manualmente.</div>}

            {showConfirm ? (
              <div className="flex flex-col gap-6 animate-in fade-in duration-300">
                <h2 className="text-3xl font-black uppercase text-[#c2185b] mb-2 border-b-[6px] border-black pb-2">Confirmar Registro</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-sm md:text-base">
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Pacote:</strong> <br/>{formData.pacote || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">ID Item:</strong> <br/>{formData.idItem || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Centro:</strong> <br/>{formData.centro || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#ffe082]"><strong className="text-black uppercase">Origem/Curso:</strong> <br/>{formData.origem || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Disciplina / Assunto:</strong> <br/>{formData.disciplina || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Produtor / Requerente / Estudantes:</strong> <br/>{[formData.produtor, formData.estudante2, formData.estudante3].filter(Boolean).join(' | ') || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-white"><strong className="text-black uppercase">Orientador(a):</strong> <br/>{formData.orientador || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Data do Documento:</strong> <br/>{formData.dataDocumento || '-'}</div>
                    <div className="p-3 border-[3px] border-black bg-[#f8bbd0]"><strong className="text-black uppercase">Tipo Documental:</strong> <br/>{formData.tipoDocumental || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Série:</strong> <br/>{formData.serie || '-'}</div>
                    <div className="col-span-1 md:col-span-2 p-3 border-[3px] border-black bg-[#e0f7fa]"><strong className="text-black uppercase">Código Classificação IFES/SIGA:</strong> <br/>{formData.codigo || '-'}</div>
                </div>
                <div className="flex flex-col md:flex-row gap-4 mt-4">
                   <button onClick={confirmAndSubmit} className="flex-1 bg-[#00bcd4] border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-cyan-300 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none">Salvar na Planilha</button>
                   <button onClick={() => setShowConfirm(false)} className="flex-1 bg-white border-[6px] border-black py-4 font-black uppercase tracking-wider text-xl hover:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:translate-x-1 active:shadow-none">Voltar e Editar</button>
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
                    <label className="font-black text-black uppercase tracking-wide">Centro</label>
                    <input type="text" name="centro" value={formData.centro} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Origem (Curso/Depto)</label>
                    <input type="text" list="listaOrigens" name="origem" value={formData.origem} onChange={handleChange} className="w-full border-[4px] border-black p-3 focus:outline-none focus:bg-white font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                </div>

                <div className="flex flex-col gap-6 p-6 border-[6px] border-black bg-white">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-xs">Disciplina / Assunto *</label>
                    <input required type="text" list="listaDisciplinas" name="disciplina" value={formData.disciplina} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-[#c2185b] text-xs">Orientador(a) / Professor(a)</label>
                    <input type="text" list="listaOrientadores" name="orientador" value={formData.orientador} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t-[4px] border-black border-dashed">
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm">Produtor / Estudante 1 *</label>
                      <input required type="text" list="listaProdutores" name="produtor" value={formData.produtor} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 2</label>
                      <input type="text" list="listaProdutores" name="estudante2" value={formData.estudante2} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="font-black text-black uppercase tracking-wide text-sm text-gray-500">Estudante 3</label>
                      <input type="text" list="listaProdutores" name="estudante3" value={formData.estudante3} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-gray-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#f8bbd0] p-6 border-[6px] border-black">
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Tipo Documental</label>
                    <input type="text" list="listaTipos" name="tipoDocumental" value={formData.tipoDocumental} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Série Documental</label>
                    <input type="text" list="listaSeries" name="serie" value={formData.serie} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide">Data do Documento (Mês/Ano ou Ano) *</label>
                    <input required type="text" name="dataDocumento" value={formData.dataDocumento} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-black focus:outline-none focus:bg-white uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" placeholder="Ex: 2008-11" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="font-black text-black uppercase tracking-wide text-gray-700 text-xs">Código de Classificação IFES/SIGA</label>
                    <input type="text" list="codigosSiga" name="codigo" value={formData.codigo} onChange={handleChange} className="w-full border-[4px] border-black p-3 font-bold focus:outline-none focus:bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" placeholder="Selecione ou digite..." />
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
                      {["Data de análise", "ID Item", "Centro", "Origem", "Produtor", "Disciplina/Assunto", "Data do documento", "Tipo", "Série"].map((header) => (
                        <th key={header} onClick={() => handleSort(header === "Disciplina/Assunto" ? "Disciplina" : header === "Tipo" ? "Tipo Documental" : header)} className="border-b-[6px] border-r-[4px] border-black p-4 font-black uppercase text-xs cursor-pointer hover:bg-cyan-300 last:border-r-0">
                          {header} {sortConfig.key === header && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-gray-50">
                    {sortedItems.length === 0 ? (
                      <tr><td colSpan="9" className="p-8 text-center font-bold text-gray-500 uppercase">O Acervo está Vazio.</td></tr>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-yellow-100 border-b-[4px] border-black last:border-b-0 text-sm">
                          <td className="p-4 font-mono text-[10px] border-r-[4px] border-black">{item["Data de análise"]}</td>
                          <td className="p-4 font-black text-[#c2185b] border-r-[4px] border-black">{item["ID Item"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Centro"]?.substring(0,20)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Origem"]?.substring(0,20)}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Produtor"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Disciplina"]?.substring(0,30)}</td>
                          <td className="p-4 font-black border-r-[4px] border-black bg-[#ffe082]">{item["Data do documento"]}</td>
                          <td className="p-4 font-bold border-r-[4px] border-black">{item["Tipo Documental"]}</td>
                          <td className="p-4 font-bold">{item["Série"]?.substring(0,20)}</td>
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
